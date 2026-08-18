import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 200, height: 400 } });
await page.goto('about:blank');
const r = await page.evaluate(() => {
  const c = document.createElement('canvas');
  c.width = 200; c.height = 400;
  const gl = c.getContext('webgl2');
  // draw a 1px point at clip (0, +0.5) — should be TOP half if +y=up
  const VS = '#version 300 es\nprecision highp float;\nvoid main(){ gl_Position = vec4(0.0, 0.5, 0.0, 1.0); gl_PointSize = 10.0; }';
  const FS = '#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main(){ o = vec4(1.0,0.0,0.0,1.0); }';
  function mk(t,s){const x=gl.createShader(t);gl.shaderSource(x,s);gl.compileShader(x);return x;}
  const p=gl.createProgram(); gl.attachShader(p,mk(gl.VERTEX_SHADER,VS)); gl.attachShader(p,mk(gl.FRAGMENT_SHADER,FS)); gl.linkProgram(p);
  gl.useProgram(p); gl.viewport(0,0,200,400); gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.POINTS, 0, 1);
  const buf = new Uint8Array(200*400*4);
  gl.readPixels(0,0,200,400,gl.RGBA,gl.UNSIGNED_BYTE,buf);
  // find the red pixel's y
  let fy = -1;
  for (let y=0;y<400;y++) for (let x=0;x<200;x++) {
    const i=(y*200+x)*4;
    if (buf[i]>200 && buf[i+3]>200) { fy = y; }
  }
  return { fy, note: 'if fy ~100 => clip +0.5 = TOP; if fy ~300 => clip +0.5 = BOTTOM' };
});
console.log(JSON.stringify(r));
await browser.close();
