import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 1600 } });
await page.goto('http://localhost:4173/src/pages/fwdlinks/index.html', { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const result = await page.evaluate(async () => {
  const mod = await import('/src/shared/scene/scribbleShader.js');
  const ic = document.getElementById('imageContainer');
  const runs = [];
  for (let r = 0; r < 6; r++) {
    const api = mod.initScribbleShader({ container: ic, strokeCount: 60 });
    api.setOpenness(1);
    const canvases = ic.querySelectorAll('.scribbleLayer');
    const c = canvases[canvases.length - 1];
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    const w = c.width, h = c.height;
    const buf = new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,buf);
    let sumX=0,sumY=0,nz=0;
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const a = buf[(y*w+x)*4+3];
      if (a>10) { sumX+=x; sumY+=y; nz++; }
    }
    runs.push({ cx: sumX/nz, cyTop: h - (sumY/nz) });
  }
  return {
    avgX: (runs.reduce((a,b)=>a+b.cx,0)/runs.length).toFixed(0),
    avgY: (runs.reduce((a,b)=>a+b.cyTop,0)/runs.length).toFixed(0)
  };
});
console.log('AVG center:', JSON.stringify(result), 'target 450,800');
await browser.close();
