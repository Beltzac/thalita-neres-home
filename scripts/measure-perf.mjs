/**
 * Performance measurement script for all Thalita Neres pages.
 *
 * Starts vite preview, visits each page N times, collects:
 *   FCP, LCP, TTFB, DOMContentLoaded, Load, transferred KB, request count
 *
 * Usage:
 *   npm run build && node scripts/measure-perf.mjs           # measure dist/
 *   node scripts/measure-perf.mjs --dev                       # measure dev server
 *   node scripts/measure-perf.mjs --runs 5 --output report.json
 */

import { chromium } from 'playwright';
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ── Config ────────────────────────────────────────────────────────────────────
const PAGES = [
  { name: 'index',              path: '/index.html' },
  { name: 'home',               path: '/src/pages/home/index.html' },
  { name: 'sobre-mim',          path: '/src/pages/sobre-mim/index.html' },
  { name: 'maquina-escrever',   path: '/src/pages/maquina-escrever/index.html' },
  { name: 'filme-fotografico',  path: '/src/pages/filme-fotografico/index.html' },
  { name: 'pastas',             path: '/src/pages/pastas/index.html' },
  { name: 'mesa-arquitetura',   path: '/src/pages/mesa-arquitetura/index.html' },
  { name: 'projetos',           path: '/src/pages/projetos/index.html' },
];

function flagVal(name, fallback) {
  const eq = process.argv.find(a => a.startsWith(`--${name}=`));
  if (eq) return eq.split('=')[1];
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && idx + 1 < process.argv.length) return process.argv[idx + 1];
  return fallback;
}

const RUNS = parseInt(flagVal('runs', '3'));
const DEV_MODE = process.argv.includes('--dev');
const OUTPUT = flagVal('output', null);
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function startServer() {
  return new Promise((ok, fail) => {
    const args = DEV_MODE ? ['vite', '--port', String(PORT)] : ['vite', 'preview', '--port', String(PORT)];
    const proc = spawn('npx', args, {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let started = false;
    const onData = (data) => {
      const text = data.toString();
      if (!started && text.includes('localhost')) {
        started = true;
        // small delay to ensure server is ready
        setTimeout(() => ok(proc), 500);
      }
    };

    proc.stdout.on('data', onData);
    proc.stderr.on('data', onData);

    setTimeout(() => {
      if (!started) fail(new Error('Server timeout'));
    }, 30000);

    proc.on('error', fail);
  });
}

async function measurePage(browser, url) {
  const context = await browser.newContext();
  const page = await context.newPage();

  // Register LCP observer BEFORE navigating (must be active during paint)
  await page.evaluate(() => {
    window.__lcpValue = 0;
    try {
      new PerformanceObserver((list) => {
        const entries = list.getEntries();
        if (entries.length) window.__lcpValue = entries[entries.length - 1].startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    } catch { /* not supported */ }
  });

  // Navigate and wait for load + idle
  const start = Date.now();
  await page.goto(url, { waitUntil: 'load', timeout: 30000 });
  // Give time for JS execution, lazy images, canvas rendering
  await page.waitForTimeout(2000);

  // Collect metrics
  const paintTiming = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0] || {};
    const fp = performance.getEntriesByType('paint').find(e => e.name === 'first-paint');
    const fcp = performance.getEntriesByType('paint').find(e => e.name === 'first-contentful-paint');

    // LCP from pre-registered observer
    let lcp = window.__lcpValue || 0;

    // Fallback: try buffered entries if observer didn't fire
    if (lcp === 0) {
      try {
        const entries = performance.getEntriesByType('largest-contentful-paint');
        if (entries.length) lcp = entries[entries.length - 1].startTime;
      } catch { /* */ }
    }

    return {
      ttfb: nav.responseStart - nav.requestStart,
      domContentLoaded: nav.domContentLoadedEventEnd - nav.fetchStart,
      load: nav.loadEventEnd - nav.fetchStart,
      fcp: fcp ? fcp.startTime : 0,
      lcp,
      fp: fp ? fp.startTime : 0,
      dnsTime: nav.domainLookupEnd - nav.domainLookupStart,
      tcpTime: nav.connectEnd - nav.connectStart,
      domInteractive: nav.domInteractive - nav.fetchStart,
    };
  });

  // Get transferred size via CDP (more accurate than response headers)
  let totalTransferred = 0;
  let totalEncoded = 0;
  try {
    const networkData = await client.send('Network.getResponseBodyForInterception', {}).catch(() => null);
  } catch { /* */ }

  // Fallback: use Performance API resource timing
  const resourceSizes = await page.evaluate(() => {
    const resources = performance.getEntriesByType('resource');
    let transferred = 0;
    let encoded = 0;
    let count = 0;
    for (const r of resources) {
      transferred += r.transferSize || 0;
      encoded += r.encodedBodySize || 0;
      if (r.transferSize > 0) count++;
    }
    return { transferred, encoded, count };
  });

  // Get navigation timing entry for the document itself
  const navSize = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      transferred: nav?.transferSize || 0,
      encoded: nav?.encodedBodySize || 0,
    };
  });

  totalTransferred = resourceSizes.transferred + navSize.transferred;
  totalEncoded = resourceSizes.encoded + navSize.encoded;

  // JS heap size
  const jsHeap = await page.evaluate(() => {
    if (performance.memory) return performance.memory.usedJSHeapSize;
    return 0;
  });

  await context.close();

  return {
    ...paintTiming,
    transferredKB: Math.round(totalTransferred / 1024 * 10) / 10,
    encodedKB: Math.round(totalEncoded / 1024 * 10) / 10,
    requestCount: resourceSizes.count + 1, // +1 for document
    jsHeapMB: Math.round(jsHeap / 1024 / 1024 * 10) / 10,
    wallTime: Date.now() - start,
  };
}

function avg(arr) {
  return Math.round(arr.reduce((a, b) => a + b, 0) / arr.length * 10) / 10;
}

function formatRow(name, metrics) {
  const m = metrics;
  const fcp = m.fcp > 1000 ? `${(m.fcp/1000).toFixed(1)}s` : `${Math.round(m.fcp)}ms`;
  const lcp = m.lcp > 1000 ? `${(m.lcp/1000).toFixed(1)}s` : `${Math.round(m.lcp)}ms`;
  const ttfb = `${Math.round(m.ttfb)}ms`;
  const load = m.load > 1000 ? `${(m.load/1000).toFixed(1)}s` : `${Math.round(m.load)}ms`;
  const dcl = m.domContentLoaded > 1000 ? `${(m.domContentLoaded/1000).toFixed(1)}s` : `${Math.round(m.domContentLoaded)}ms`;

  return [
    name.padEnd(20),
    fcp.padStart(8),
    lcp.padStart(8),
    ttfb.padStart(8),
    dcl.padStart(8),
    load.padStart(8),
    `${m.transferredKB} KB`.padStart(12),
    String(m.requestCount).padStart(6),
    `${m.jsHeapMB} MB`.padStart(8),
  ].join('  ');
}

function printHeader() {
  const cols = [
    'Page'.padEnd(20),
    'FCP'.padStart(8),
    'LCP'.padStart(8),
    'TTFB'.padStart(8),
    'DCL'.padStart(8),
    'Load'.padStart(8),
    'Transferred'.padStart(12),
    'Reqs'.padStart(6),
    'JS Heap'.padStart(8),
  ];
  console.log(cols.join('  '));
  console.log('─'.repeat(cols.join('  ').length));
}

// ── Flag slow values ──────────────────────────────────────────────────────────
function flag(value, threshold, unit) {
  if (value > threshold) return `\x1b[31m${value}${unit}\x1b[0m`;   // red
  if (value > threshold * 0.7) return `\x1b[33m${value}${unit}\x1b[0m`; // yellow
  return `\x1b[32m${value}${unit}\x1b[0m`;  // green
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n📊  Thalita Neres — Performance Audit`);
  console.log(`Mode: ${DEV_MODE ? 'vite dev' : 'vite preview (dist/)'}  |  Runs per page: ${RUNS}\n`);

  // Start server
  const server = await startServer();

  // Launch browser
  const browser = await chromium.launch({ headless: true });

  const results = {};
  const report = {};

  printHeader();

  for (const { name, path } of PAGES) {
    const url = `${BASE_URL}${path}`;
    const allRuns = [];

    for (let run = 1; run <= RUNS; run++) {
      try {
        const metrics = await measurePage(browser, url);
        allRuns.push(metrics);
      } catch (err) {
        console.error(`  ⚠  ${name} run ${run} failed: ${err.message}`);
      }
    }

    if (allRuns.length === 0) {
      console.log(formatRow(name, { fcp: 'ERR', lcp: 'ERR', ttfb: 'ERR', domContentLoaded: 'ERR', load: 'ERR', transferredKB: 0, requestCount: 0, jsHeapMB: 0 }));
      report[name] = { error: 'All runs failed' };
      continue;
    }

    // Average
    const avgMetrics = {
      fcp: avg(allRuns.map(r => r.fcp)),
      lcp: avg(allRuns.map(r => r.lcp)),
      ttfb: avg(allRuns.map(r => r.ttfb)),
      domContentLoaded: avg(allRuns.map(r => r.domContentLoaded)),
      load: avg(allRuns.map(r => r.load)),
      transferredKB: avg(allRuns.map(r => r.transferredKB)),
      requestCount: avg(allRuns.map(r => r.requestCount)),
      jsHeapMB: avg(allRuns.map(r => r.jsHeapMB)),
    };

    results[name] = avgMetrics;

    console.log(formatRow(name, avgMetrics));

    report[name] = {
      avg: avgMetrics,
      runs: allRuns,
    };
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n─── Flags ───');
  console.log('(red = slow, yellow = borderline, green = good)\n');

  const thresholds = {
    fcp: { label: 'FCP', threshold: 1800, unit: 'ms' },
    lcp: { label: 'LCP', threshold: 2500, unit: 'ms' },
    ttfb: { label: 'TTFB', threshold: 600, unit: 'ms' },
    transferredKB: { label: 'Transferred', threshold: 2000, unit: ' KB' },
    domContentLoaded: { label: 'DCL', threshold: 2000, unit: 'ms' },
  };

  for (const [name, m] of Object.entries(results)) {
    const flagged = [];
    for (const [key, { label, threshold, unit }] of Object.entries(thresholds)) {
      if (m[key] > threshold * 0.7) {
        flagged.push(`${label}: ${flag(m[key], threshold, unit)}`);
      }
    }
    if (flagged.length) {
      console.log(`  ${name.padEnd(20)} ${flagged.join('  ')}`);
    }
  }

  // Total across all pages
  const totalKB = Object.values(results).reduce((s, m) => s + m.transferredKB, 0);
  const totalReqs = Object.values(results).reduce((s, m) => s + m.requestCount, 0);
  const avgLoad = avg(Object.values(results).map(m => m.load));

  console.log(`\n─── Totals ───`);
  console.log(`  All pages combined transferred: ${Math.round(totalKB)} KB`);
  console.log(`  All pages combined requests:    ${Math.round(totalReqs)}`);
  console.log(`  Average Load time:               ${avgLoad > 1000 ? (avgLoad/1000).toFixed(1) + 's' : Math.round(avgLoad) + 'ms'}`);

  // ── Save report ────────────────────────────────────────────────────────────
  if (OUTPUT) {
    writeFileSync(resolve(root, OUTPUT), JSON.stringify(report, null, 2));
    console.log(`\n  📄 Report saved: ${OUTPUT}`);
  }

  // Cleanup
  await browser.close();
  server.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
