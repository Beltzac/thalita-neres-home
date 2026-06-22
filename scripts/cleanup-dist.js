/**
 * Removes .png files from dist/ that have a corresponding .webp sibling.
 * These PNGs are not referenced by any page — dead weight in deployment.
 */

import { readdir, unlink } from 'fs/promises';
import { join, extname, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const distDir = join(root, 'dist');

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const files = await collectFiles(distDir);
  const webpBases = new Set();
  const pngFiles = [];

  for (const f of files) {
    const ext = extname(f).toLowerCase();
    if (ext === '.webp') {
      const base = f.slice(0, -5); // remove .webp
      webpBases.add(base);
    } else if (ext === '.png') {
      pngFiles.push(f);
    }
  }

  let removed = 0;
  let kept = 0;

  for (const png of pngFiles) {
    const base = png.slice(0, -4); // remove .png
    if (webpBases.has(base)) {
      await unlink(png);
      removed++;
    } else {
      kept++;
    }
  }

  const relative = (p) => p.replace(root, '').replaceAll('\\', '/');
  console.log(`[cleanup-dist] Removed ${removed} orphaned .png files (${kept} .png kept — no .webp sibling)`);
}

main().catch(err => {
  console.error('[cleanup-dist] Error:', err.message);
  process.exit(1);
});
