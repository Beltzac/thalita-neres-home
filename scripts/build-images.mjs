/**
 * Compile step: derives public/**.webp from the pristine public/**.png artwork.
 *
 * The PNGs are the source of truth and stay full resolution. The runtime never
 * reads pixel dimensions from the files, so scaling every image by one factor
 * leaves layout and hit detection untouched; `precomputedCentersByUrl` keeps the
 * source-pixel space (and with it ACTIVE_RADIUS and the spiralSearch distances).
 *
 * Deterministic: the same inputs always produce the same bytes. A derived WebP
 * that is newer than its PNG is treated as current and not re-encoded, so repeat
 * runs are near-instant. Use --force to re-encode regardless.
 *
 * Usage:
 *   node scripts/build-images.mjs                 # write derived WebP (incremental)
 *   node scripts/build-images.mjs --force         # re-encode every image
 *   node scripts/build-images.mjs --check         # verify, exit 1 on drift
 *   node scripts/build-images.mjs --scale 0.4 --quality 78
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, extname, resolve, dirname, relative } from 'path';
import { fileURLToPath } from 'url';
import os from 'os';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const publicDir = join(root, 'public');

const args = process.argv.slice(2);
const CHECK = args.includes('--check');
const FORCE = args.includes('--force');

function flag(name, fallback) {
  const eq = args.find((a) => a.startsWith(`${name}=`));
  if (eq) {
    return eq.split('=')[1];
  }
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) {
    return args[idx + 1];
  }
  return fallback;
}

const SCALE = Number(flag('--scale', '0.5333'));
const QUALITY = Number(flag('--quality', '82'));

if (!Number.isFinite(SCALE) || SCALE <= 0 || SCALE > 1) {
  console.error(`[build-images] invalid --scale: ${SCALE}`);
  process.exit(1);
}
if (!Number.isFinite(QUALITY) || QUALITY < 1 || QUALITY > 100) {
  console.error(`[build-images] invalid --quality: ${QUALITY}`);
  process.exit(1);
}

const CONCURRENCY = Math.max(2, Math.min(os.cpus().length, 8));

async function collectPng(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectPng(full)));
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') {
      files.push(full);
    }
  }
  return files;
}

async function mtimeMs(filePath) {
  try {
    return (await stat(filePath)).mtimeMs;
  } catch {
    return null;
  }
}

async function runWithConcurrency(items, worker, concurrency) {
  let index = 0;
  async function runWorker() {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) {
        return;
      }
      await worker(items[current]);
    }
  }
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => runWorker());
  await Promise.all(workers);
}

function fmt(bytes) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function main() {
  const pngFiles = await collectPng(publicDir);
  pngFiles.sort();

  let pngTotal = 0;
  let webpTotal = 0;
  let upToDate = 0;
  let current = 0;
  let failed = 0;
  const written = [];
  const drifted = [];

  await runWithConcurrency(
    pngFiles,
    async (pngPath) => {
      const webpPath = pngPath.replace(/\.png$/i, '.webp');
      const pngStat = await stat(pngPath);
      pngTotal += pngStat.size;

      const existingMtime = await mtimeMs(webpPath);
      const existingSize = existingMtime === null ? null : (await stat(webpPath)).size;

      // Incremental path: nothing to do when the derived file is newer than its source.
      if (!FORCE && existingMtime !== null && existingMtime >= pngStat.mtimeMs) {
        upToDate++;
        webpTotal += existingSize;
        return;
      }

      try {
        const input = await readFile(pngPath);
        const meta = await sharp(input).metadata();
        const targetWidth = Math.max(1, Math.round(meta.width * SCALE));
        const output = await sharp(input)
          .resize({ width: targetWidth, withoutEnlargement: true, fit: 'inside' })
          .webp({ quality: QUALITY, effort: 6, alphaQuality: 100 })
          .toBuffer();

        webpTotal += output.length;

        if (existingMtime !== null && existingSize === output.length) {
          const existing = await readFile(webpPath);
          if (existing.equals(output)) {
            current++;
            return;
          }
        }

        const rel = relative(publicDir, webpPath).replaceAll('\\', '/');
        drifted.push({ name: rel, from: existingSize ?? 0, to: output.length, created: existingMtime === null });

        if (!CHECK) {
          await writeFile(webpPath, output);
          written.push(rel);
        }
      } catch (error) {
        failed++;
        console.error(`[build-images] failed ${relative(publicDir, pngPath)}: ${error.message}`);
      }
    },
    CONCURRENCY
  );

  console.log(
    `[build-images] ${pngFiles.length} PNG (${fmt(pngTotal)}) -> WebP (${fmt(webpTotal)}) | scale=${SCALE} q${QUALITY}`
  );

  for (const d of drifted.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`[build-images] ${d.created ? 'create' : 'stale '} ${d.name} | ${fmt(d.from)} -> ${fmt(d.to)}`);
  }

  if (CHECK) {
    if (drifted.length > 0) {
      console.error(`[build-images] FAIL: ${drifted.length} derived WebP out of date`);
      process.exitCode = 1;
      return;
    }
    console.log(`[build-images] OK: derived WebP current (${upToDate} cached, ${current} verified)`);
    return;
  }

  console.log(
    `[build-images] done | written=${written.length} verified=${current} cached=${upToDate} failed=${failed}`
  );
  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[build-images] failed:', error.message);
  process.exitCode = 1;
});