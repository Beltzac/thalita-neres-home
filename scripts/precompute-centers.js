import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import https from 'https';
import sharp from 'sharp';
import { sceneConfigSchema } from './schemas.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'src', 'data');
const pagesDir = path.join(rootDir, 'src', 'pages');

const SCENE_CONFIGS = new Set([
  'home.json',
  'sobre-mim.json',
  'maquina-escrever.json',
  'filme-fotografico.json',
  'cabeca.json'
]);

function isRemoteUrl(value) {
  return /^https?:\/\//i.test(value);
}

function normalizeKey(value) {
  if (!value) {return '';}
  const clean = value.split('#')[0].split('?')[0];
  if (isRemoteUrl(clean)) {
    try {
      const url = new URL(clean);
      return url.pathname.replace(/^\/+/, '');
    } catch {
      return clean;
    }
  }
  return clean.replace(/^\/+/, '').replace(/^\.\//, '');
}

function resolveImageKey(baseUrl, filename) {
  if (!filename) {return '';}
  if (isRemoteUrl(filename)) {return filename;}
  if (!baseUrl) {return filename;}
  if (isRemoteUrl(baseUrl)) {return new URL(filename, baseUrl).toString();}
  return `${baseUrl}${filename}`;
}

function download(url) {
  const client = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const request = client.get(url, (res) => {
      const status = res.statusCode || 0;
      if (status >= 300 && status < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, url).toString();
        res.resume();
        download(redirectUrl).then(resolve).catch(reject);
        return;
      }

      if (status !== 200) {
        res.resume();
        reject(new Error(`Failed to download ${url} (status ${status})`));
        return;
      }

      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });

    request.on('error', reject);
  });
}

async function loadImageBuffer(imageKey, pageDir) {
  if (isRemoteUrl(imageKey)) {
    return download(imageKey);
  }

  const isAbsoluteFromRoot = /^\//.test(imageKey);
  const cleanedKey = imageKey.replace(/^\/+/, '').replace(/^\.\//, '');
  const candidates = [];

  if (isAbsoluteFromRoot) {
    // Public-style absolute path (served from "/...")
    candidates.push(path.join(rootDir, cleanedKey));
    candidates.push(path.join(rootDir, 'public', cleanedKey));
    // Source pages fallback (for paths like "/filme-fotografico/imagens/..." that live under src/pages)
    candidates.push(path.join(pagesDir, cleanedKey));
  } else {
    // Relative to current page folder first
    candidates.push(path.join(pageDir, cleanedKey));
    // Then project root as fallback
    candidates.push(path.join(rootDir, cleanedKey));
    candidates.push(path.join(rootDir, 'public', cleanedKey));
  }

  for (const filePath of candidates) {
    try {
      await fs.access(filePath);
      return fs.readFile(filePath);
    } catch {
      // try next candidate
    }
  }

  throw new Error(`Unable to resolve local image path for key: ${imageKey}`);
}

function summarizeComponents(components, width, height) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let totalX = 0;
  let totalY = 0;
  let count = 0;

  for (const component of components) {
    if (component.minX < minX) {minX = component.minX;}
    if (component.maxX > maxX) {maxX = component.maxX;}
    if (component.minY < minY) {minY = component.minY;}
    if (component.maxY > maxY) {maxY = component.maxY;}
    totalX += component.totalX;
    totalY += component.totalY;
    count += component.count;
  }

  if (!count) {
    return {
      centerX: width / 2,
      centerY: height / 2,
      bboxCenterX: width / 2,
      bboxCenterY: height / 2,
      contentWidth: 0,
      contentHeight: 0,
    };
  }

  return {
    centerX: totalX / count,
    centerY: totalY / count,
    bboxCenterX: minX + ((maxX - minX) / 2),
    bboxCenterY: minY + ((maxY - minY) / 2),
    contentWidth: (maxX - minX) + 1,
    contentHeight: (maxY - minY) + 1,
  };
}

function encodeRuns(values) {
  const runs = [];
  let currentValue = 0;
  let runLength = 0;

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    if (value === currentValue) {
      runLength++;
      continue;
    }

    runs.push(runLength.toString(36));
    currentValue = value;
    runLength = 1;
  }

  runs.push(runLength.toString(36));
  return runs.join('.');
}

async function computeInstructionMask(buffer, { maxSize = 320, threshold = 50 } = {}) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .resize({
      width: maxSize,
      height: maxSize,
      fit: 'fill',
    })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const values = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      values[(y * width) + x] = alpha > threshold ? 1 : 0;
    }
  }

  return {
    width,
    height,
    runs: encodeRuns(values),
  };
}

async function computeCenter(buffer, { multiAnchor = false, useAllComponents = false } = {}) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  const grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > 50) {
        grid[y * width + x] = 1;
      }
    }
  }

  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (grid[idx] === 1 && !visited[idx]) {
        const queue = [idx];
        let queueIndex = 0;
        visited[idx] = 1;

        let minX = x;
        let maxX = x;
        let minY = y;
        let maxY = y;
        let totalX = 0;
        let totalY = 0;
        let count = 0;

        while (queueIndex < queue.length) {
          const cur = queue[queueIndex++];
          const cx = cur % width;
          const cy = (cur - cx) / width;
          totalX += cx;
          totalY += cy;
          count++;
          if (cx < minX) {minX = cx;}
          if (cx > maxX) {maxX = cx;}
          if (cy < minY) {minY = cy;}
          if (cy > maxY) {maxY = cy;}

          if (cx > 0 && grid[cur - 1] === 1 && !visited[cur - 1]) {
            visited[cur - 1] = 1;
            queue.push(cur - 1);
          }
          if (cx < width - 1 && grid[cur + 1] === 1 && !visited[cur + 1]) {
            visited[cur + 1] = 1;
            queue.push(cur + 1);
          }
          if (cy > 0 && grid[cur - width] === 1 && !visited[cur - width]) {
            visited[cur - width] = 1;
            queue.push(cur - width);
          }
          if (cy < height - 1 && grid[cur + width] === 1 && !visited[cur + width]) {
            visited[cur + width] = 1;
            queue.push(cur + width);
          }
        }

        components.push({ count, minX, maxX, minY, maxY, totalX, totalY });
      }
    }
  }

  if (components.length === 0) {
    return {
      centerX: width / 2,
      centerY: height / 2,
      bboxCenterX: width / 2,
      bboxCenterY: height / 2,
      width,
      height,
      contentWidth: 0,
      contentHeight: 0,
      ...(multiAnchor ? {
        hitCenterX: width / 2,
        hitCenterY: height / 2,
        hitBboxCenterX: width / 2,
        hitBboxCenterY: height / 2,
        hitContentWidth: 0,
        hitContentHeight: 0,
        hitAnchors: [{ x: width / 2, y: height / 2, count: 0 }],
      } : {}),
    };
  }

  components.sort((a, b) => b.count - a.count);
  const main = components[0];
  const mainSummary = summarizeComponents(useAllComponents ? components : [main], width, height);

  const result = {
    centerX: mainSummary.centerX,
    centerY: mainSummary.centerY,
    bboxCenterX: mainSummary.bboxCenterX,
    bboxCenterY: mainSummary.bboxCenterY,
    width,
    height,
    contentWidth: mainSummary.contentWidth,
    contentHeight: mainSummary.contentHeight,
  };

  if (!multiAnchor) {
    return result;
  }

  const minClusterSize = main.count * 0.05;
  const hitComponents = components.filter((component) => component.count >= minClusterSize);
  const hitSummary = summarizeComponents(hitComponents, width, height);

  return {
    ...result,
    hitCenterX: hitSummary.centerX,
    hitCenterY: hitSummary.centerY,
    hitBboxCenterX: hitSummary.bboxCenterX,
    hitBboxCenterY: hitSummary.bboxCenterY,
    hitContentWidth: hitSummary.contentWidth,
    hitContentHeight: hitSummary.contentHeight,
    hitAnchors: hitComponents.map((component) => ({
      x: component.totalX / component.count,
      y: component.totalY / component.count,
      count: component.count,
    })),
  };
}

async function precomputeForConfig(fileName) {
  const filePath = path.join(dataDir, fileName);
  const pageName = path.basename(fileName, '.json');
  const pageDir = path.join(pagesDir, pageName);

  const raw = await fs.readFile(filePath, 'utf8');
  const parsed = JSON.parse(raw);

  const validation = sceneConfigSchema.safeParse(parsed);
  if (!validation.success) {
    console.error(`Config validation failed for ${fileName}:`);
    console.error(validation.error.format());
    throw new Error(`Invalid config: ${fileName}`);
  }

  const config = validation.data;
  const baseUrl = config.baseUrl;
  const imageKeys = [];

  if (config.baseImageFilename) {
    imageKeys.push({
      imageKey: resolveImageKey(baseUrl, config.baseImageFilename),
      multiAnchor: false,
      useAllComponents: true,
      includeInstructionMask: Boolean(config.instructionTextAvoidDrawing?.enabled),
    });
  }

  if (Array.isArray(config.overlayImages)) {
    config.overlayImages.forEach((overlay) => {
      if (overlay?.arquivo) {
        imageKeys.push({
          imageKey: resolveImageKey(baseUrl, overlay.arquivo),
          multiAnchor: true,
        });
      }
    });
  }

  const precomputed = {};

  for (const { imageKey, multiAnchor, useAllComponents = false, includeInstructionMask = false } of imageKeys) {
    if (!imageKey) {continue;}
    if (precomputed[imageKey]) {continue;}

    const buffer = await loadImageBuffer(imageKey, pageDir);
    const centerData = await computeCenter(buffer, { multiAnchor, useAllComponents });
    if (includeInstructionMask) {
      centerData.instructionMask = await computeInstructionMask(buffer);
    }
    precomputed[imageKey] = centerData;

    const normalized = normalizeKey(imageKey);
    if (normalized && !precomputed[normalized]) {
      precomputed[normalized] = centerData;
    }
  }

  config.precomputedCentersByUrl = precomputed;
  await fs.writeFile(filePath, JSON.stringify(config, null, 2));
}

async function run() {
  const entries = await fs.readdir(dataDir);
  const configs = entries.filter((entry) => SCENE_CONFIGS.has(entry));

  for (const entry of configs) {
    await precomputeForConfig(entry);
  }
}

run().catch((error) => {
  console.error('Failed to precompute centers:', error);
  process.exitCode = 1;
});
