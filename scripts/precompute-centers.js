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
  let totalX = 0;
  let totalY = 0;
  let count = 0;
  let minX = width;
  let maxX = 0;
  let minY = height;
  let maxY = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * channels;
      const alpha = data[index + 3];
      if (alpha > 0) {
        totalX += x;
        totalY += y;
        count += 1;
        if (x < minX) {minX = x;}
        if (x > maxX) {maxX = x;}
        if (y < minY) {minY = y;}
        if (y > maxY) {maxY = y;}
      }
    }
  }

  if (count === 0) {
    minX = 0;
    maxX = width;
    minY = 0;
    maxY = height;
  }

  const centerX = count > 0 ? totalX / count : width / 2;
  const centerY = count > 0 ? totalY / count : height / 2;

  return {
    centerX,
    centerY,
    bboxCenterX: minX + (maxX - minX) / 2,
    bboxCenterY: minY + (maxY - minY) / 2,
    width,
    height,
    contentWidth: (maxX - minX) + 1,
    contentHeight: (maxY - minY) + 1
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
