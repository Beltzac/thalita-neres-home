import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const LOSSLESS_EXTENSIONS = new Set(['.png', '.webp', '.avif', '.tif', '.tiff']);
const SKIPPED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.gif', '.svg', '.ico']);

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
    return { optimized: true, bytesSaved: input.length - output.length };
  }

  return { optimized: false, skipped: false, bytesSaved: 0 };
}

async function run() {
  try {
    await fs.access(distDir);
  } catch {
    console.log('No dist directory found. Skipping image optimization.');
    return;
  }

  const files = await collectFiles(distDir);
  let optimizedCount = 0;
  let skippedCount = 0;
  let totalSaved = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (!LOSSLESS_EXTENSIONS.has(ext) && !SKIPPED_EXTENSIONS.has(ext)) continue;

    if (SKIPPED_EXTENSIONS.has(ext)) {
      skippedCount += 1;
      continue;
    }

    const result = await optimizeLossless(file);
    if (result.skipped) {
      skippedCount += 1;
      continue;
    }

    if (result.optimized) {
      optimizedCount += 1;
      totalSaved += result.bytesSaved || 0;
    }
  }

  console.log(`Image optimization completed. Optimized: ${optimizedCount}, skipped: ${skippedCount}, saved: ${totalSaved} bytes.`);
}

run().catch((error) => {
  console.error('Failed to optimize images:', error);
  process.exitCode = 1;
});

