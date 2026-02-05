import { promises as fs } from 'fs';
import path from 'path';
import { parse } from 'node-html-parser';

const distDir = path.resolve(process.cwd(), 'dist');

async function collectHtmlFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return collectHtmlFiles(fullPath);
    }
    if (entry.isFile() && entry.name.endsWith('.html')) {
      return [fullPath];
    }
    return [];
  }));
  return files.flat();
}

function isLocalAsset(href) {
  return href && !href.startsWith('http') && !href.startsWith('//');
}

function resolveAssetPath(htmlFile, assetPath) {
  const normalized = assetPath.replace(/^\//, '');
  if (normalized.startsWith('assets/')) {
    return path.join(distDir, normalized);
  }
  return path.resolve(path.dirname(htmlFile), normalized);
}

async function inlineAssetsInHtml(htmlFile) {
  const html = await fs.readFile(htmlFile, 'utf-8');
  const root = parse(html, { script: true, style: true, pre: true });

  const links = root.querySelectorAll('link[rel="stylesheet"]');
  for (const link of links) {
    const href = link.getAttribute('href');
    if (!isLocalAsset(href)) {
      continue;
    }
    const assetPath = resolveAssetPath(htmlFile, href);
    const css = await fs.readFile(assetPath, 'utf-8');
    const styleEl = parse(`<style>\n${css}\n</style>`);
    link.replaceWith(styleEl);
  }

  const scripts = root.querySelectorAll('script[src]');
  for (const script of scripts) {
    const src = script.getAttribute('src');
    if (!isLocalAsset(src)) {
      continue;
    }
    const assetPath = resolveAssetPath(htmlFile, src);
    const js = await fs.readFile(assetPath, 'utf-8');
    const typeAttr = script.getAttribute('type');
    const typePart = typeAttr ? ` type="${typeAttr}"` : '';
    const inlineScript = parse(`<script${typePart}>\n${js}\n</script>`);
    script.replaceWith(inlineScript);
  }

  await fs.writeFile(htmlFile, root.toString(), 'utf-8');
}

async function main() {
  const htmlFiles = await collectHtmlFiles(distDir);
  for (const file of htmlFiles) {
    await inlineAssetsInHtml(file);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
