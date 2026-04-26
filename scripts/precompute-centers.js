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
  'filme-fotografico.json'
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

async function computeCenter(buffer) {
  const { data, info } = await sharp(buffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;

  // Build binary grid of non-transparent pixels
  const grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * channels + 3];
      if (alpha > 50) {
        grid[y * width + x] = 1;
      }
    }
  }

  // Flood-fill to find connected components
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (grid[idx] === 1 && !visited[idx]) {
        // BFS flood fill
        const queue = [idx];
        visited[idx] = 1;
        const pixels = [];
        let minX = x, maxX = x, minY = y, maxY = y;
        let totalX = 0, totalY = 0, count = 0;

        while (queue.length > 0) {
          const cur = queue.shift();
          const cx = cur % width;
          const cy = (cur - cx) / width;
          pixels.push(cur);
          totalX += cx;
          totalY += cy;
          count++;
          if (cx < minX) {minX = cx;}
          if (cx > maxX) {maxX = cx;}
          if (cy < minY) {minY = cy;}
          if (cy > maxY) {maxY = cy;}

          // 4-connected neighbors
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
      centerX: width / 2, centerY: height / 2,
      bboxCenterX: width / 2, bboxCenterY: height / 2,
      width, height, contentWidth: 0, contentHeight: 0
    };
  }

  // Find largest component by pixel count
  components.sort((a, b) => b.count - a.count);
  const main = components[0];

  const centerX = main.totalX / main.count;
  const centerY = main.totalY / main.count;

  return {
    centerX,
    centerY,
    bboxCenterX: main.minX + (main.maxX - main.minX) / 2,
    bboxCenterY: main.minY + (main.maxY - main.minY) / 2,
    width,
    height,
    contentWidth: (main.maxX - main.minX) + 1,
    contentHeight: (main.maxY - main.minY) + 1
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
    imageKeys.push(resolveImageKey(baseUrl, config.baseImageFilename));
  }

  if (Array.isArray(config.overlayImages)) {
    config.overlayImages.forEach((overlay) => {
      if (overlay?.arquivo) {
        imageKeys.push(resolveImageKey(baseUrl, overlay.arquivo));
      }
    });
  }

  const precomputed = {};

  for (const imageKey of imageKeys) {
    if (!imageKey) {continue;}
    if (precomputed[imageKey]) {continue;}

    const buffer = await loadImageBuffer(imageKey, pageDir);
    const centerData = await computeCenter(buffer);
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
