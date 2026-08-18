// Simple YOLO object detection via Transformers.js (yolos-tiny, COCO 80 classes).
// GPU (DirectML) -> CPU fallback; persistent disk cache.
import { pipeline } from '@huggingface/transformers';
import { loadWithFallback, fileCache } from './local.js';

const MODEL_ID = process.env.YOLO_MODEL || 'Xenova/yolos-tiny';
const DEFAULT_DTYPE = process.env.YOLO_DTYPE || 'fp32';

let _detector = null, _device = null;

async function load() {
  if (!_detector) {
    const { model, device } = await loadWithFallback((device) =>
      pipeline('object-detection', MODEL_ID, { dtype: DEFAULT_DTYPE, device })
    );
    _detector = model; _device = device;
  }
  return _detector;
}

export function getYoloDevice() { return _device || 'not-loaded'; }
export function getYoloModelInfo() { return { model: MODEL_ID, dtype: DEFAULT_DTYPE, device: getYoloDevice() }; }

export async function detectObjects(filePath, {
  threshold = parseFloat(process.env.YOLO_THRESHOLD || '0.5'),
} = {}) {
  const options = { threshold };
  const cache = fileCache(filePath);
  const cached = cache.get(options);
  if (cached) return { ...cached, cached: true };

  const detector = await load();
  const raw = await detector(filePath, { threshold });
  const detections = (raw || []).map((d) => ({
    label: d.label,
    score: d.score,
    box: d.box,
    center: { x: (d.box.xmin + d.box.xmax) / 2, y: (d.box.ymin + d.box.ymax) / 2 },
  }));

  const result = { detections, count: detections.length, cached: false };
  return cache.set(options, result);
}
