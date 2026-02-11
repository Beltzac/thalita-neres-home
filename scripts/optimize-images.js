import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const LOSSLESS_EXTENSIONS = new Set(['.png', '.webp', '.avif', '.tif', '.tiff']);
const SKIPPED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.gif', '.svg', '.ico']);
const DEFAULT_CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 12));

async function collectFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(fullPath));
      continue;
    }
    if (entry.isFile()) files.push(fullPath);
  }

  return files;
}

async function optimizeLossless(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!LOSSLESS_EXTENSIONS.has(ext)) return { optimized: false, skipped: true };

  const input = await fs.readFile(filePath);
  const image = sharp(input, { animated: true });

  let pipeline;
  if (ext === '.png') {
    pipeline = image.png({ compressionLevel: 9, adaptiveFiltering: true, palette: false, quality: 100 });
  } else if (ext === '.webp') {
    pipeline = image.webp({ lossless: true, effort: 6 });
  } else if (ext === '.avif') {
    pipeline = image.avif({ lossless: true, effort: 9 });
  } else {
    pipeline = image.tiff({ compression: 'lzw' });
  }

  const output = await pipeline.toBuffer();

  if (output.length < input.length) {
    await fs.writeFile(filePath, output);
    return {
      optimized: true,
      bytesSaved: input.length - output.length,
      beforeBytes: input.length,
      afterBytes: output.length,
      ext,
      filePath,
    };
  }

  return {
    optimized: false,
    skipped: false,
    bytesSaved: 0,
    beforeBytes: input.length,
    afterBytes: output.length,
    ext,
    filePath,
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(2)} ${units[unitIndex]}`;
}

function relativeFromRoot(fullPath) {
  return path.relative(rootDir, fullPath).replaceAll('\\', '/');
}

async function runWithConcurrency(items, worker, concurrency) {
  if (items.length === 0) return;

  let index = 0;
  async function runWorker(workerId) {
    while (true) {
      const currentIndex = index;
      index += 1;
      if (currentIndex >= items.length) return;
      await worker(items[currentIndex], currentIndex, workerId);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, (_, i) => runWorker(i + 1));
  await Promise.all(workers);
}

async function run() {
  try {
    await fs.access(distDir);
  } catch {
    console.log('No dist directory found. Skipping image optimization.');
    return;
  }

  const files = await collectFiles(distDir);
  const candidateFiles = [];
  const unsupportedCount = { value: 0 };

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!LOSSLESS_EXTENSIONS.has(ext) && !SKIPPED_EXTENSIONS.has(ext)) {
      unsupportedCount.value += 1;
      continue;
    }
    candidateFiles.push(file);
  }

  const processableFiles = candidateFiles.filter((file) => {
    const ext = path.extname(file).toLowerCase();
    return LOSSLESS_EXTENSIONS.has(ext);
  });

  const skippedByConfig = candidateFiles.length - processableFiles.length;
  const startTime = Date.now();
  const concurrency = DEFAULT_CONCURRENCY;

  console.log(`[optimize-images] Starting optimization`);
  console.log(`[optimize-images] dist: ${relativeFromRoot(distDir)}`);
  console.log(`[optimize-images] scanned files: ${files.length}`);
  console.log(`[optimize-images] candidates (known image ext): ${candidateFiles.length}`);
  console.log(`[optimize-images] processable (lossless): ${processableFiles.length}`);
  console.log(`[optimize-images] skipped by config (jpg/jpeg/gif/svg/ico): ${skippedByConfig}`);
  console.log(`[optimize-images] ignored unsupported files: ${unsupportedCount.value}`);
  console.log(`[optimize-images] concurrency: ${concurrency}`);

  let optimizedCount = 0;
  let skippedCount = 0;
  let totalSaved = 0;
  let unchangedCount = 0;
  let errorCount = 0;
  let processedCount = 0;

  const heartbeat = setInterval(() => {
    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[optimize-images] progress ${processedCount}/${processableFiles.length} | optimized=${optimizedCount} unchanged=${unchangedCount} errors=${errorCount} | elapsed=${elapsedSec}s`);
  }, 2000);

  await runWithConcurrency(
    processableFiles,
    async (file) => {
      try {
        const result = await optimizeLossless(file);
        if (result.skipped) {
          skippedCount += 1;
        } else if (result.optimized) {
          optimizedCount += 1;
          totalSaved += result.bytesSaved || 0;
          const pct = result.beforeBytes > 0
            ? ((result.bytesSaved / result.beforeBytes) * 100).toFixed(2)
            : '0.00';
          console.log(`[optimized] ${relativeFromRoot(file)} | ${formatBytes(result.beforeBytes)} -> ${formatBytes(result.afterBytes)} | saved ${formatBytes(result.bytesSaved)} (${pct}%)`);
        } else {
          unchangedCount += 1;
          console.log(`[unchanged] ${relativeFromRoot(file)} | kept ${formatBytes(result.beforeBytes)} (optimized version not smaller)`);
        }
      } catch (error) {
        errorCount += 1;
        console.error(`[error] ${relativeFromRoot(file)} | ${error?.message || error}`);
      } finally {
        processedCount += 1;
      }
    },
    concurrency,
  );

  clearInterval(heartbeat);

  const elapsedMs = Date.now() - startTime;
  const elapsedSec = (elapsedMs / 1000).toFixed(2);

  console.log('');
  console.log('[optimize-images] Done');
  console.log(`[optimize-images] optimized: ${optimizedCount}`);
  console.log(`[optimize-images] unchanged: ${unchangedCount}`);
  console.log(`[optimize-images] skipped: ${skippedCount + skippedByConfig}`);
  console.log(`[optimize-images] errors: ${errorCount}`);
  console.log(`[optimize-images] total saved: ${formatBytes(totalSaved)} (${totalSaved} bytes)`);
  console.log(`[optimize-images] elapsed: ${elapsedSec}s`);
}

run().catch((error) => {
  console.error('Failed to optimize images:', error);
  process.exitCode = 1;
});
