#!/usr/bin/env node
// "Gemma Eyes + SAM + YOLO" — visual review tool.
// Gemma 4 vision (OpenRouter) + local SAM segmentation + local YOLO detection.
// SAM and YOLO run by default; pass --no-sam / --no-yolo to skip.

import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
// local.js MUST be first (sets ORT_LOG_LEVEL before onnxruntime loads).
import './local.js';
import { askGemma, DEFAULT_MODEL, imageToDataUrl } from './gemma.js';
import { segmentImage, getDevice } from './sam.js';
import { detectObjects, getYoloDevice } from './yolo.js';

const require = createRequire(import.meta.url);
const sharpModule = require('sharp');
const sharp = sharpModule.default ?? sharpModule;

function pathToFileURLString(p) { try { return pathToFileURL(p).href; } catch { return ''; } }

function parseArgs(argv) {
  const images = [];
  let question = null;
  let withSam = true, withYolo = true, asJson = false, compare = false, visualize = false;
  let model = DEFAULT_MODEL;
  let gridX = null, gridY = null, threshold = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-sam') withSam = false;
    else if (a === '--sam') withSam = true;
    else if (a === '--no-yolo') withYolo = false;
    else if (a === '--yolo') withYolo = true;
    else if (a === '--json') asJson = true;
    else if (a === '--compare') compare = true;
    else if (a === '--masks') visualize = true;          // #6/#8: emit mask PNGs
    else if (a === '--grid') { const v=argv[++i]; if(v) gridX=parseInt(v); }
    else if (a === '--threshold') { const v=argv[++i]; if(v) threshold=parseFloat(v); }
    else if (a === '--question' || a === '-q') question = argv[++i];
    else if (a === '--model') model = argv[++i];
    else if (a.startsWith('-')) { /* ignore */ }
    else images.push(a);
  }
  return { images, question, withSam, withYolo, asJson, compare, visualize, model, gridX, gridY, threshold };
}

const DEFAULT_PROMPT =
  'Describe this image in detail: what it shows, its composition/layout, where the content vs empty space is, any text/symbols, and what it likely represents. Be specific and concise.';

// #9: build the Gemma image payload from the ORIGINAL file bytes (mime-aware),
// falling back to PNG re-encode only when the format isn't directly supported.
async function imageToDataUrlSmart(sharp, filePath) {
  const ext = filePath.split('.').pop().toLowerCase();
  if (['png','jpg','jpeg','webp'].includes(ext)) {
    const { readFile } = await import('node:fs/promises');
    const buf = await readFile(filePath);
    const mime = ext === 'jpg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
    return 'data:' + mime + ';base64,' + buf.toString('base64');
  }
  return imageToDataUrl(sharp, filePath);
}

export async function analyze({ images, question=null, withSam=true, withYolo=true, visualize=false, gridX=null, gridY=null, threshold=null, model=DEFAULT_MODEL }) {
  const results = [];
  for (const img of images) {
    const entry = { image: img };
    const dataUrl = await imageToDataUrlSmart(sharp, img);

    if (withSam) entry.segmentation = await segmentImage(img, { visualize, gridX, gridY });
    if (withYolo) entry.detection = await detectObjects(img, { threshold });

    let prompt = question || DEFAULT_PROMPT;
    if (entry.detection && entry.detection.detections.length) {
      prompt += '\n\n[A local YOLO object detector identified these objects (class, confidence, bbox, center):] ' + JSON.stringify(entry.detection.detections) + '\nUse these labels where they match what you see; ignore irrelevant or low-confidence detections.';
    }
    if (entry.segmentation && entry.segmentation.regions.length) {
      prompt += '\n\n[Optional local SAM segmentation regions (pixel coords, background already discarded). Ground positions/sizes where they agree.] ' + JSON.stringify(entry.segmentation.regions);
    }

    entry.answer = await askGemma({ imageDataUrls: [dataUrl], prompt, model });
    results.push(entry);
  }
  return results;
}

export async function analyzeGroup({ images, question=null, withSam=true, withYolo=true, visualize=false, gridX=null, gridY=null, threshold=null, model=DEFAULT_MODEL }) {
  const dataUrls = [], segs = [], dets = [];
  for (const img of images) {
    dataUrls.push(await imageToDataUrlSmart(sharp, img));
    if (withSam) segs.push({ image: img, segmentation: await segmentImage(img, { visualize, gridX, gridY }) });
    if (withYolo) dets.push({ image: img, detection: await detectObjects(img, { threshold }) });
  }

  let prompt = question
    ? 'I am providing ' + images.length + ' images, in order. ' + question
    : 'I am providing ' + images.length + ' images, in order. Describe and compare each one, noting how they differ and what each represents.';
  if (dets.length) prompt += '\n\n[Local YOLO detections, one list per image in order:] ' + JSON.stringify(dets);
  if (segs.length) prompt += '\n\n[Optional SAM regions, one list per image in order:] ' + JSON.stringify(segs);

  const answer = await askGemma({ imageDataUrls: dataUrls, prompt, model });
  return { images: images.slice(), segmentation: segs, detection: dets, answer };
}

async function main() {
  const { images, question, withSam, withYolo, asJson, compare, visualize, model, gridX, gridY, threshold } = parseArgs(process.argv.slice(2));
  if (!images.length) {
    console.error('Usage: gemma-eyes.mjs <image...> [-q "question"] [--compare] [--json] [--masks] [--grid N] [--threshold N] [--no-sam] [--no-yolo]');
    process.exit(2);
  }

  const opts = { images, question, withSam, withYolo, visualize, gridX, gridY, threshold, model };
  const results = compare ? [await analyzeGroup(opts)] : await analyze(opts);

  if (asJson) {
    process.stdout.write(JSON.stringify(results, null, 2) + '\n');
  } else if (compare) {
    const r = results[0];
    for (const seg of (r.segmentation||[])) {
      console.log('===== [SAM] ' + seg.image + ' =====  ' + seg.segmentation.regionCount + ' region(s) — device: ' + getDevice());
      if (seg.segmentation.masks) for (const m of seg.segmentation.masks) console.log('    mask -> ' + m.file);
    }
    for (const d of (r.detection||[])) {
      if (d.detection.count) console.log('[YOLO] ' + d.image.split(/[\\/]/).pop() + ': ' + d.detection.detections.map(x=>x.label).join(', '));
    }
    if ((r.segmentation||[]).length || (r.detection||[]).length) console.log('');
    console.log(r.answer);
  } else {
    for (const r of results) {
      console.log('===== ' + r.image + ' =====');
      if (r.detection) {
        console.log('[YOLO] ' + r.detection.count + ' object(s) — device: ' + getYoloDevice());
        for (const d of r.detection.detections) console.log('    ' + d.label + ' (' + d.score.toFixed(3) + ') box [' + d.box.xmin + ',' + d.box.ymin + ',' + d.box.xmax + ',' + d.box.ymax + ']');
      }
      if (r.segmentation) {
        console.log('[SAM] ' + r.segmentation.regionCount + ' region(s), ' + r.segmentation.width + 'x' + r.segmentation.height + ' — device: ' + getDevice());
        for (const reg of r.segmentation.regions) console.log('    region ' + reg.index + ': area ' + reg.area + 'px (' + (reg.areaFraction*100).toFixed(1) + '%) center(' + Math.round(reg.center.x) + ',' + Math.round(reg.center.y) + ') score ' + reg.score.toFixed(3));
        if (r.segmentation.masks) for (const m of r.segmentation.masks) console.log('    mask -> ' + m.file);
      }
      console.log('');
      console.log(r.answer);
      console.log('');
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURLString(process.argv[1])) {
  main().catch((err) => { console.error('gemma-eyes failed:', err.message); process.exit(1); });
}
