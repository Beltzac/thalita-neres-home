import { execSync } from 'child_process';

const pages = [
  'home',
  'sobre-mim',
  'maquina-escrever',
  'filme-fotografico',
  'pastas',
  'mesa-arquitetura',
  'index'
];

for (const page of pages) {
  execSync(`vite build`, {
    stdio: 'inherit',
    env: {
      ...process.env,
      SINGLE_INPUT: page
    }
  });
}
