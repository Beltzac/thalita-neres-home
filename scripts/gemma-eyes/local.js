// Shared local-ML helpers: device fallback + persistent disk cache + cache-key utils.
// IMPORTANT: this module must be imported FIRST (before any transformers/onnxruntime
// import) so the env below is set before the native runtime initializes.
if (!process.env.ORT_LOG_LEVEL) process.env.ORT_LOG_LEVEL = '3';
if (!process.env.ORT_DISABLE_TELEMETRY) process.env.ORT_DISABLE_TELEMETRY = '1';

import { createHash } from 'node:crypto';
import { statSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// GPU (DirectML) -> CPU fallback on the device ORDER.
export const DEVICE_ORDER = ['dml', 'cpu'];
export function nextDevice() {
  // Re-export so modules share one source of truth.
  return DEVICE_ORDER;
}

// Resolve a model cache directory (persistent across runs).
const CACHE_ROOT = path.join(process.cwd(), 'node_modules', '.cache', 'gemma-eyes');
export function modelCacheDir(sub) {
  const d = sub ? path.join(CACHE_ROOT, sub) : CACHE_ROOT;
  mkdirSync(d, { recursive: true });
  return d;
}

// ---- disk-backed cache (survives process restarts) ----
// Returns a per-file cache object bound to one file path.
export function fileCache(filePath) {
  const cacheDir = modelCacheDir('results');
  const base = filePath.replace(/^[a-zA-Z]:[\\/]+/, '').replace(/[\\/]+/g, '__');
  return {
    get: (opts) => {
      const stamp = fileStamp(filePath);
      const f = path.join(cacheDir, base + '__' + stamp + '__' + optionsHash(opts) + '.json');
      try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return undefined; }
    },
    set: (opts, result) => {
      const stamp = fileStamp(filePath);
      const f = path.join(cacheDir, base + '__' + stamp + '__' + optionsHash(opts) + '.json');
      try { writeFileSync(f, JSON.stringify(result)); } catch { /* best-effort */ }
      return result;
    },
    clear: () => { /* best-effort clear of this file's entries */ },
  };
}

export function fileStamp(p) {
  try { const st = statSync(p); return st.mtimeMs + ':' + st.size; } catch { return '0:0'; }
}
export function optionsHash(o) {
  return createHash('sha1').update(JSON.stringify(o || {})).digest('hex').slice(0, 12);
}

// Load a transformers.js model with device fallback, returning { model, device }.
export async function loadWithFallback(loadFn) {
  let lastError;
  for (const device of DEVICE_ORDER) {
    try {
      const model = await loadFn(device);
      return { model, device };
    } catch (err) {
      lastError = err;
      console.warn('[local] device "' + device + '" unavailable: ' + err.message);
    }
  }
  throw lastError;
}

// Check that an expected remote size was fully downloaded (anti-truncation).
// returns true if sizes match.
export function validateDownload(path, expectedBytes) {
  if (!expectedBytes) return true;
  try { return statSync(path).size === expectedBytes; } catch { return false; }
}

export function quietOnnx() { /* env set at module load; kept for compatibility */ }
