// Local SAM (Segment Anything) via Transformers.js (slimsam-50).
//   * GPU (DirectML) -> CPU fallback
//   * persistent disk cache (same image + options = instant across runs)
//   * background-region discard (touching edge / >maxAreaFraction)
//   * optional mask PNG visualization
import { SamModel, AutoProcessor, RawImage } from '@huggingface/transformers';
import {
  loadWithFallback, fileCache, fileStamp, optionsHash,
  modelCacheDir, validateDownload,
} from './local.js';

const MODEL_ID = process.env.SAM_MODEL || 'Xenova/slimsam-50-uniform';
const DEFAULT_DTYPE = process.env.SAM_DTYPE || 'fp32'; // fp16/fp32; q8 truncated on this setup

let _model = null, _processor = null, _device = null;

async function load() {
  if (!_model) {
    const { model, device } = await loadWithFallback((device) =>
      SamModel.from_pretrained(MODEL_ID, { dtype: DEFAULT_DTYPE, device })
    );
    _model = model; _device = device;
  }
  if (!_processor) _processor = await AutoProcessor.from_pretrained(MODEL_ID);
  return { model: _model, processor: _processor };
}

export function getDevice() { return _device || 'not-loaded'; }
export function getSamModelInfo() { return { model: MODEL_ID, dtype: DEFAULT_DTYPE, device: getDevice() }; }

function summarize(mask) {
  const [H, W] = mask.dims;
  const data = mask.data;
  let count = 0, minX = W, maxX = -1, minY = H, maxY = -1, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[y * W + x]) { count++; sx += x; sy += y; if (x<minX)minX=x; if (x>maxX)maxX=x; if (y<minY)minY=y; if (y>maxY)maxY=y; }
  }
  if (!count) return null;
  return { count, bbox: { x:minX, y:minY, w:maxX-minX+1, h:maxY-minY+1 }, center: { x:sx/count, y:sy/count } };
}
function bboxIoU(a, b) {
  const x1=Math.max(a.x,b.x),y1=Math.max(a.y,b.y),x2=Math.min(a.x+a.w,b.x+b.w),y2=Math.min(a.y+a.h,b.y+b.h);
  const inter=Math.max(0,x2-x1)*Math.max(0,y2-y1), union=a.w*a.h+b.w*b.h-inter;
  return union>0?inter/union:0;
}

async function runSam(raw, points) {
  const { model, processor } = await load();
  const inputs = await processor(raw, { input_points: points });
  const outputs = await model(inputs);
  const masks = await processor.post_process_masks(outputs.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes);
  return { masks: masks[0], scores: outputs.iou_scores };
}

export async function segmentImage(filePath, {
  gridX = parseInt(process.env.SAM_GRID_X || '9'),
  gridY = parseInt(process.env.SAM_GRID_Y || '16'),
  minArea = 500,
  dedupIoU = 0.6,
  discardBackground = true,       // #1: drop >90% or full-edge-touching region
  maxAreaFraction = 0.9,
  visualize = false,              // #6: also emit mask PNGs
} = {}) {
  const options = { gridX, gridY, minArea, dedupIoU, discardBackground, maxAreaFraction };
  const cache = fileCache(filePath);

  const cached = cache.get(options);
  if (cached) return { ...cached, cached: true };

  const raw = await RawImage.read(filePath);
  const { width, height } = raw;

  const points = [];
  for (let gy = 0; gy < gridY; gy++) for (let gx = 0; gx < gridX; gx++)
    points.push([[Math.round(((gx+0.5)/gridX)*width), Math.round(((gy+0.5)/gridY)*height)]]);

  const { masks, scores } = await runSam(raw, points);
  const [P, C, H, W] = masks.dims;
  const totalPx = width * height;

  const candidates = [];
  for (let p = 0; p < P; p++) {
    let best = { score: -1, tensor: null, bestC: 0 };
    for (let c = 0; c < C; c++) {
      const score = Number(scores.data[p * C + c]);
      const one = masks[p][c];
      if (score > best.score) best = { score, tensor: one, bestC: c };
    }
    const s = summarize(best.tensor);
    if (s && s.count >= minArea) {
      const areaFraction = s.count / totalPx;
      // #1: discard background — region covering most of image or touching all edges.
      const touchesAllEdges =
        s.bbox.x <= 1 && s.bbox.y <= 1 &&
        (s.bbox.x + s.bbox.w) >= width - 1 && (s.bbox.y + s.bbox.h) >= height - 1;
      if (discardBackground && (areaFraction > maxAreaFraction || touchesAllEdges)) continue;
      candidates.push({ promptIndex: p, candIndex: best.bestC, tensor: best.tensor, area: s.count, areaFraction, bbox: s.bbox, center: s.center, score: best.score });
    }
  }

  candidates.sort((a, b) => b.area - a.area);
  const regions = [];
  const regionTensors = [];
  for (const cand of candidates) {
    if (regions.some((r) => bboxIoU(r.bbox, cand.bbox) > dedupIoU)) continue;
    regions.push(cand);
    regionTensors.push(cand);
  }
  regions.forEach((r, i) => { r.index = i; delete r.tensor; delete r.promptIndex; delete r.candIndex; });

  const result = { width, height, regionCount: regions.length, regions, cached: false };

  // #6: optional mask visualization (red overlay PNGs saved to cache dir)
  if (visualize) {
    const vis = [];
    for (let i = 0; i < regionTensors.length; i++) {
      const r = regionTensors[i];
      const outFile = path.join(modelCacheDir('masks'), pathBase(filePath) + '__' + i + '.png');
      await compositeMaskOverlay(filePath, r.tensor, outFile);
      vis.push({ index: i, file: outFile, area: r.area, score: r.score });
    }
    result.masks = vis;
  }

  return cache.set(options, result);
}

// ---- mask visualization via sharp (red overlay on original) ----
import sharp from 'sharp';
import path from 'node:path';

function pathBase(p) { return path.basename(p).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_'); }

async function compositeMaskOverlay(srcFile, maskTensor, outFile) {
  const H = maskTensor.dims[0], W = maskTensor.dims[1];
  const data = maskTensor.data;
  const { width, height } = await sharp(srcFile).metadata();
  // Build an RGBA red-alpha overlay sized to the image.
  const overlay = Buffer.alloc(width * height * 4);
  // Map mask (W,H) -> image (width,height) by simple stretch (they share aspect from SAM resize).
  const sx = width / W, sy = height / H;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const mx = Math.min(W - 1, Math.floor(x / sx));
      const my = Math.min(H - 1, Math.floor(y / sy));
      const on = data[my * W + mx];
      const i = (y * width + x) * 4;
      if (on) { overlay[i]=255; overlay[i+1]=40; overlay[i+2]=40; overlay[i+3]=200; }
      else { overlay[i]=0; overlay[i+1]=0; overlay[i+2]=0; overlay[i+3]=0; }
    }
  }
  const overlayImg = sharp(overlay, { raw: { width, height, channels: 4 } }).png();
  await sharp(srcFile).composite([{ input: await overlayImg.toBuffer(), raw: { width, height, channels: 4 } }]).png().toFile(outFile);
}
