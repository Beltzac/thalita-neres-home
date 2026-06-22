/**
 * Converts all PNG images in public/ to WebP (lossy) and updates all references.
 *
 * Usage:
 *   node scripts/convert-to-webp.mjs             # quality 90 (default)
 *   node scripts/convert-to-webp.mjs --quality 95
 *   node scripts/convert-to-webp.mjs --dry-run    # preview only
 */

import { readFile, writeFile, readdir, stat } from 'fs/promises';
import { join, extname, dirname, relative, resolve } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import sharp from 'sharp';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const publicDir = join(root, 'public');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const QUALITY = parseInt(args.find(a => a.startsWith('--quality='))?.split('=')[1] || '90');

// ── Collect all PNGs in public/ ───────────────────────────────────────────────
async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === '.png') {
      files.push(full);
    }
  }
  return files;
}

// ── Update references in a file ──────────────────────────────────────────────
async function updateReferences(filePath) {
  let content = await readFile(filePath, 'utf-8');
  const original = content;
  // Replace .png → .webp (case-insensitive for the extension)
  content = content.replace(/\.png(?=["'\s)])/gi, '.webp');
  if (content !== original) {
    if (!DRY_RUN) await writeFile(filePath, content);
    return true;
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🖼  PNG → WebP Converter  (quality=${QUALITY}${DRY_RUN ? ', DRY-RUN' : ''})\n`);

  // Step 1: Collect PNGs
  const pngFiles = await collectFiles(publicDir);
  console.log(`Found ${pngFiles.length} PNG files in public/\n`);

  if (pngFiles.length === 0) {
    console.log('No PNGs to convert.');
    return;
  }

  let totalPngSize = 0;
  let totalWebpSize = 0;
  let converted = 0;
  const errors = [];

  // Step 2: Convert each PNG → WebP
  for (const pngPath of pngFiles) {
    const relPath = relative(publicDir, pngPath);
    const webpPath = pngPath.replace(/\.png$/i, '.webp');

    try {
      const input = await readFile(pngPath);
      const metadata = await sharp(input).metadata();

      // Convert RGBA renders with lossy WebP
      // Grayscale (ch <= 2) → use near-lossless WebP since they compress well anyway
      const isPhoto = (metadata.channels || 0) >= 3;
      const webpQuality = isPhoto ? QUALITY : 100; // grayscale = lossless

      const output = await sharp(input)
        .webp({
          quality: webpQuality,
          lossless: !isPhoto,
          effort: 6,
        })
        .toBuffer();

      const pngKb = (input.length / 1024).toFixed(1);
      const webpKb = (output.length / 1024).toFixed(1);
      const reduction = ((1 - output.length / input.length) * 100).toFixed(0);
      const tag = isPhoto ? `q${webpQuality}` : 'lossless';

      console.log(`  ${relPath.padEnd(55)} ${pngKb.padStart(7)} KB  →  ${webpKb.padStart(7)} KB  (${reduction}%)  [${tag}]`);

      if (!DRY_RUN) {
        await writeFile(webpPath, output);
        // Keep original PNG alongside WebP
      }

      totalPngSize += input.length;
      totalWebpSize += output.length;
      converted++;
    } catch (err) {
      errors.push({ file: relPath, error: err.message });
      console.error(`  ✗ ${relPath}: ${err.message}`);
    }
  }

  // Step 3: Update JSON configs + HTML
  console.log(`\n--- Updating references ---\n`);

  const refFiles = [
    ...(await collectRefFiles(join(root, 'src/data'), '.json')),
    ...(await collectRefFiles(join(root, 'src/pages'), '.html')),
  ];

  for (const file of refFiles) {
    const changed = await updateReferences(file);
    if (changed) {
      console.log(`  ✓ ${relative(root, file)}`);
    }
  }

  // Also check wixPage.js if it has references
  const wixPage = join(root, 'wixPage.js');
  if (existsSync(wixPage)) {
    const changed = await updateReferences(wixPage);
    if (changed) console.log(`  ✓ wixPage.js`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalReduction = ((1 - totalWebpSize / totalPngSize) * 100).toFixed(0);
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  Converted:  ${converted}/${pngFiles.length} files`);
  console.log(`  Total PNG:  ${(totalPngSize / 1024).toFixed(0)} KB`);
  console.log(`  Total WebP: ${(totalWebpSize / 1024).toFixed(0)} KB`);
  console.log(`  Saved:      ${((totalPngSize - totalWebpSize) / 1024).toFixed(0)} KB  (${totalReduction}%)`);
  if (errors.length) console.log(`  Errors:     ${errors.length}`);
  if (DRY_RUN) console.log(`\n  ⚠  DRY-RUN — no files were changed.`);
  console.log('');
}

async function collectRefFiles(dir, ext) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRefFiles(full, ext)));
    } else if (entry.isFile() && extname(entry.name).toLowerCase() === ext) {
      files.push(full);
    }
  }
  return files;
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
