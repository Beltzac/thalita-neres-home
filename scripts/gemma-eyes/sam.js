// Local SAM (Segment Anything Model) segmentation via Transformers.js.
// Runs offline on CPU (onnxruntime-node) — no GPU/torch needed.
//
//   segmentImage(filePath, opts)  -> automatic whole-image region proposal via a
//                                    grid of point prompts, deduplicated by IoU.
//   segmentPoints(filePath, pts)  -> prompt-based masks for explicit [[x,y],...].
//
// Each region: { index, score, area, bbox, center }.

import { SamModel, AutoProcessor, RawImage } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/sam-vit-base';

let _model = null;
let _processor = null;

async function load() {
  if (!_model) _model = await SamModel.from_pretrained(MODEL_ID, { dtype: 'fp32', device: 'cpu' });
  if (!_processor) _processor = await AutoProcessor.from_pretrained(MODEL_ID);
  return { model: _model, processor: _processor };
}

// bool tensor dims [H, W] -> { count, bbox, center }
function summarize(mask) {
  const [H, W] = mask.dims;
  const data = mask.data; // Uint8Array 0/1
  let count = 0, minX = W, maxX = -1, minY = H, maxY = -1, sx = 0, sy = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[y * W + x]) {
        count++;
        sx += x; sy += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (!count) return null;
  return {
    count,
    bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    center: { x: sx / count, y: sy / count },
  };
}

function bboxIoU(a, b) {
  const x1 = Math.max(a.x, b.x), y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w), y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0;
}

async function runSam(raw, points) {
  const { model, processor } = await load();
  const inputs = await processor(raw, { input_points: points });
  const outputs = await model(inputs);
  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    inputs.original_sizes,
    inputs.reshaped_input_sizes
  );
  return { masks: masks[0], scores: outputs.iou_scores };
}

export async function segmentPoints(filePath, points, { minArea = 50 } = {}) {
  // points: array of [x,y]; normalize to [[[x,y]], [[x,y]], ...] (4D batch form)
  const wrapped = points.map(([x, y]) => [[x, y]]);
  const raw = await RawImage.read(filePath);
  const { masks, scores } = await runSam(raw, wrapped);

  // masks dims: [numPrompts, numCandidates(=3), H, W]
  const [P, C, H, W] = masks.dims;
  const regions = [];
  for (let p = 0; p < P; p++) {
    let best = { score: -1, tensor: null };
    for (let c = 0; c < C; c++) {
      const score = Number(scores.data[p * C + c]); // scores dims [1, P, C]
      const one = masks[p][c]; // [H, W] bool tensor
      if (score > best.score) best = { score, tensor: one };
    }
    const s = summarize(best.tensor);
    if (s && s.count >= minArea) {
      regions.push({ index: p, score: best.score, area: s.count, bbox: s.bbox, center: s.center });
    }
  }
  return regions;
}

export async function segmentImage(filePath, { gridX = 9, gridY = 16, minArea = 500, dedupIoU = 0.6 } = {}) {
  const raw = await RawImage.read(filePath);
  const { width, height } = raw;

  const points = [];
  for (let gy = 0; gy < gridY; gy++) {
    for (let gx = 0; gx < gridX; gx++) {
      points.push([
        [
          Math.round(((gx + 0.5) / gridX) * width),
          Math.round(((gy + 0.5) / gridY) * height),
        ],
      ]);
    }
  }

  const { masks, scores } = await runSam(raw, points);
  const [P, C, H, W] = masks.dims;

  // Collect best candidate per prompt.
  const candidates = [];
  for (let p = 0; p < P; p++) {
    let best = { score: -1, tensor: null };
    for (let c = 0; c < C; c++) {
      const score = Number(scores.data[p * C + c]);
      const one = masks[p][c]; // [H, W] bool tensor
      if (score > best.score) best = { score, tensor: one };
    }
    const s = summarize(best.tensor);
    if (s && s.count >= minArea) candidates.push({ ...s, area: s.count, score: best.score });
  }

  // Sort by area desc and dedup by bbox IoU.
  candidates.sort((a, b) => b.area - a.area);
  const regions = [];
  for (const cand of candidates) {
    if (regions.some((r) => bboxIoU(r.bbox, cand.bbox) > dedupIoU)) continue;
    regions.push(cand);
  }

  regions.forEach((r, i) => { r.index = i; });

  return { width, height, regionCount: regions.length, regions };
}
