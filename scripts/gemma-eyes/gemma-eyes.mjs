#!/usr/bin/env node
// "Gemma Eyes + SAM" — my visual review tool.
//
// Combines a Gemma 4 vision model (OpenRouter) for detailed natural-language
// description with a local SAM (Segment Anything) segmentation pass, so I can
// "see" images and review visual states programmatically.
//
// Usage:
//   node scripts/gemma-eyes/gemma-eyes.mjs <image...> [--question "..." | -q "..."] [--sam] [--json]
//
//   <image...>   one or more image paths (png/jpg/webp)
//   -q/--question   the question to ask about the image(s)
//   --sam           run local SAM segmentation and include region data
//   --json          emit machine-readable JSON instead of prose
//
// Env: OPENROUTER_API_KEY (optional; auto-read from HKCU registry).
// SAM model downloads once on first use (cached in node_modules/.cache).

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const sharpModule = require('sharp');
const sharp = sharpModule.default ?? sharpModule;

import { askGemma, DEFAULT_MODEL, imageToDataUrl } from './gemma.js';
import { segmentImage } from './sam.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const images = [];
  let question = null;
  let withSam = false;
  let asJson = false;
  let model = DEFAULT_MODEL;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--sam') withSam = true;
    else if (a === '--json') asJson = true;
    else if (a === '--question' || a === '-q') { question = argv[++i]; }
    else if (a === '--model') { model = argv[++i]; }
    else if (a.startsWith('-')) { /* ignore unknown flags */ }
    else images.push(a);
  }
  return { images, question, withSam, asJson, model };
}

export async function analyze({ images, question = null, withSam = false, model = DEFAULT_MODEL }) {
  const results = [];

  for (const img of images) {
    const entry = { image: img };
    const dataUrl = await imageToDataUrl(sharp, img);

    if (withSam) {
      const seg = await segmentImage(img);
      entry.segmentation = seg;
    }

    let prompt = question;
    if (!prompt) {
      prompt = 'Describe this image in detail: what it shows, its composition/layout, where the content vs empty space is, any text/symbols, and what it likely represents. Be specific and concise.';
    }
    if (entry.segmentation) {
      prompt += '\n\n[Segmentation context from a local SAM pass on this exact image]: ' +
        JSON.stringify(entry.segmentation);
      prompt += '\nUse the segmentation to ground your description in concrete regions, sizes, and positions.';
    }

    entry.answer = await askGemma({ imageDataUrls: [dataUrl], prompt, model });
    results.push(entry);
  }
  return results;
}

async function main() {
  const { images, question, withSam, asJson, model } = parseArgs(process.argv.slice(2));
  if (!images.length) {
    console.error('Usage: gemma-eyes.mjs <image...> [-q "question"] [--sam] [--json]');
    process.exit(2);
  }

  const results = await analyze({ images, question, withSam, model });

  if (asJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else {
    for (const r of results) {
      console.log('===== ' + r.image + ' =====');
      if (r.segmentation) {
        console.log('[SAM] ' + r.segmentation.regionCount + ' region(s), ' +
          r.segmentation.width + 'x' + r.segmentation.height);
        for (const reg of r.segmentation.regions) {
          console.log(`  region ${reg.index}: area ${reg.area}px, bbox (${reg.bbox.x},${reg.bbox.y},${reg.bbox.w},${reg.bbox.h}), center (${reg.center.x.toFixed(0)},${reg.center.y.toFixed(0)}), score ${reg.score.toFixed(3)}`);
        }
        console.log('');
      }
      console.log(r.answer);
      console.log('');
    }
  }
}

main().catch((err) => {
  console.error('gemma-eyes failed:', err.message);
  process.exit(1);
});
