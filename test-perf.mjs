// Performance test for mesa-arquitetura page
// Usage: node test-perf.mjs
// Requires: npm i puppeteer (if not already installed)

import puppeteer from 'puppeteer';

const URL = 'http://localhost:5174/src/pages/mesa-arquitetura/index.html';
const VIEWPORT = { width: 1920, height: 1080 };

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORT);

  // Collect performance entries
  await page.evaluateOnNewDocument(() => {
    window.__perfLog = [];
    const origNow = performance.now.bind(performance);
    const origMark = performance.mark.bind(performance);
    performance.mark = (name) => {
      window.__perfLog.push({ type: 'mark', name, time: origNow() });
      return origMark(name);
    };
  });

  // Track image load events
  await page.evaluateOnNewDocument(() => {
    window.__imgLoads = [];
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.name.includes('mesa-arquitetura') && entry.name.endsWith('.png')) {
          window.__imgLoads.push({
            url: entry.name,
            duration: Math.round(entry.duration),
            startTime: Math.round(entry.startTime),
            transferSize: entry.transferSize,
          });
        }
      }
    });
    obs.observe({ type: 'resource', buffered: true });
  });

  console.log(`\n=== Performance Test: Mesa Arquitetura ===\n`);
  console.log(`URL: ${URL}`);
  console.log(`Viewport: ${VIEWPORT.width}x${VIEWPORT.height}`);

  // Measure navigation
  const t0 = performance.now();
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  const navTime = performance.now() - t0;

  // Wait for loader to disappear (all images loaded)
  try {
    await page.waitForFunction(
      () => {
        const loader = document.querySelector('.lds-facebook');
        return loader && (loader.style.display === 'none' || loader.offsetParent === null);
      },
      { timeout: 15000 }
    );
  } catch {
    console.log('⚠ Loader did not hide within timeout');
  }

  const t1 = performance.now();
  const totalLoadTime = t1 - t0;

  // Get paint timings
  const paintTiming = await page.evaluate(() => {
    const paint = performance.getEntriesByType('paint');
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      fcp: paint.find(p => p.name === 'first-contentful-paint')?.startTime ?? null,
      fp: paint.find(p => p.name === 'first-paint')?.startTime ?? null,
      domContentLoaded: nav?.domContentLoadedEventEnd ?? null,
      domComplete: nav?.domComplete ?? null,
      loadEventEnd: nav?.loadEventEnd ?? null,
    };
  });

  // Get image load data
  const imgLoads = await page.evaluate(() => window.__imgLoads || []);

  // Count rendered items
  const renderedCount = await page.evaluate(() => {
    return document.querySelectorAll('.mesa-item').length;
  });

  // Screenshot
  await page.screenshot({ path: 'perf-result.png', fullPage: false });
  console.log('📸 Screenshot saved: perf-result.png\n');

  // Results
  console.log('── Navigation ──');
  console.log(`  networkIdle0 time : ${navTime.toFixed(0)} ms`);
  console.log(`  Total (until loader hidden) : ${totalLoadTime.toFixed(0)} ms`);

  console.log('\n── Paint Timings ──');
  console.log(`  First Paint (FP)       : ${paintTiming.fp?.toFixed(0) ?? 'N/A'} ms`);
  console.log(`  First Contentful Paint : ${paintTiming.fcp?.toFixed(0) ?? 'N/A'} ms`);
  console.log(`  DOM Content Loaded     : ${paintTiming.domContentLoaded?.toFixed(0) ?? 'N/A'} ms`);
  console.log(`  DOM Complete           : ${paintTiming.domComplete?.toFixed(0) ?? 'N/A'} ms`);
  console.log(`  Load Event End         : ${paintTiming.loadEventEnd?.toFixed(0) ?? 'N/A'} ms`);

  console.log('\n── Image Loads ──');
  console.log(`  Images rendered in DOM : ${renderedCount}`);
  console.log(`  Image resources tracked: ${imgLoads.length}`);

  if (imgLoads.length > 0) {
    imgLoads.sort((a, b) => a.startTime - b.startTime);
    const firstStart = imgLoads[0].startTime;
    const lastEnd = Math.max(...imgLoads.map(i => i.startTime + i.duration));
    const totalSpan = lastEnd - firstStart;

    console.log(`  First image fetch start: ${firstStart} ms`);
    console.log(`  Last image load end    : ${lastEnd} ms`);
    console.log(`  Image load span        : ${totalSpan} ms`);
    console.log(`  Total transfer size    : ${(imgLoads.reduce((s, i) => s + (i.transferSize || 0), 0) / 1024).toFixed(0)} KB`);

    console.log('\n  Per-image timing (sorted by start):');
    for (const img of imgLoads) {
      const fname = img.url.split('/').pop();
      const relStart = img.startTime - firstStart;
      console.log(`    ${fname.padEnd(8)} start: +${relStart.toFixed(0).padStart(5)} ms  dur: ${String(img.duration).padStart(5)} ms  size: ${((img.transferSize || 0) / 1024).toFixed(0).padStart(4)} KB`);
    }
  }

  // Check for preload effectiveness
  const preloads = await page.evaluate(() => {
    const links = document.querySelectorAll('link[rel="preload"][as="image"]');
    return Array.from(links).map(l => l.href.split('/').pop());
  });
  console.log(`\n── Preload Hints ──`);
  console.log(`  Preload links in HTML : ${preloads.length}`);
  if (preloads.length > 0) console.log(`  Files: ${preloads.join(', ')}`);

  // Concurrent loading check: how many images had overlapping fetch windows
  if (imgLoads.length > 1) {
    let maxConcurrent = 0;
    for (const a of imgLoads) {
      let concurrent = 1;
      const aEnd = a.startTime + a.duration;
      for (const b of imgLoads) {
        if (b === a) continue;
        const bEnd = b.startTime + b.duration;
        if (b.startTime < aEnd && a.startTime < bEnd) concurrent++;
      }
      if (concurrent > maxConcurrent) maxConcurrent = concurrent;
    }
    console.log(`\n── Concurrency ──`);
    console.log(`  Max overlapping fetches : ${maxConcurrent}`);
    console.log(`  Loading strategy        : ${maxConcurrent >= 6 ? '✅ PARALLEL (good)' : '❌ SEQUENTIAL (bad)'}`);
  }

  await browser.close();
  console.log('\n✅ Test complete.\n');
}

main().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
