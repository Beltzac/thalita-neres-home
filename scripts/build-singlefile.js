import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { rm } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');

// Resolve the local Vite CLI and run it with the current Node binary. Going
// through `npx` adds a process per page and depends on node_modules/.bin being
// on PATH, which is not guaranteed when the build is driven by a tool runner.
const viteBin = join(dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');

const pages = [
  'home',
  'sobre-mim',
  'maquina-escrever',
  'filme-fotografico',
  'pastas',
  'mesa-arquitetura',
  'projetos',
  'cabeca',
  'index'
];

// Each page is built with SINGLE_INPUT, which sets Vite's emptyOutDir to false
// so the per-page outputs accumulate. Clear dist explicitly, otherwise assets
// from deleted pages stay in the deployment.
await rm(distDir, { recursive: true, force: true });

for (const page of pages) {
  console.log(`[build-singlefile] ${page}`);
  execFileSync(process.execPath, [viteBin, 'build'], {
    stdio: 'inherit',
    env: {
      ...process.env,
      SINGLE_INPUT: page
    }
  });
}