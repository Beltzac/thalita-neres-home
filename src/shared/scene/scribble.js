// Procedural "brain" scribble drawn at runtime to match the original
// hand-drawn loop art (cerebro.png). Optimized for smoothness and speed.
//
// Style (from Gemma+SAM analysis of cerebro.png):
//   - Smooth, round, C1-continuous loops (no jagged corners)
//   - Hand-drawn wobble via LOW-FREQUENCY radius modulation (not per-point jitter)
//   - Tapered strokes (thick mid-arc, thin tips)
//   - Density by alpha accumulation (low alpha, overlapping strokes)
//   - Growth driven by closeness (openness), centering/adjusting via setOpenness
//
// The "head" here is the whole character centered in the frame; the scribble
// mass expands outward from the head's center as openness rises.
export function initScribble({ container, baseSelector = '.headBaseImage' }) {
  const contentWrapper = container.querySelector('#contentWrapper');
  if (!contentWrapper) return {};

  const base = contentWrapper.querySelector(baseSelector);
  if (!base) return {};

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
  canvas.classList.add('scribbleLayer');
  contentWrapper.insertBefore(canvas, base.nextSibling);

  const ctx = canvas.getContext('2d');

  const W = 1080, H = 1920;
  const INK = '#1f1f1f';

  // Expansion center = middle of the frame (whole head centered).
  const CX = W / 2;
  const CY = H * 0.52;
  const MAX_RX = W * 0.46;
  const MAX_RY = H * 0.40;

  let strokes = [];
  let seed = 0;
  let lastOpenness = -1;

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Bucket to control spacing: fades strokes in from center outward.
  function buildStrokes() {
    strokes = [];
    const rnd = mulberry32(seed);
    const COUNT = 320 + Math.floor(rnd() * 80);

    for (let i = 0; i < COUNT; i++) {
      // Radial placement with center bias (denser core, sparser rim).
      const rr = Math.pow(rnd(), 1.8);
      const aa = rnd() * Math.PI * 2;
      const cx = CX + Math.cos(aa) * MAX_RX * rr;
      const cy = CY + Math.sin(aa) * MAX_RY * rr;

      // Loop size: smaller near center (dense) but round.
      const loopR = (40 + rnd() * 90) * (0.6 + rr * 0.6);
      const loopRy = loopR * (0.85 + rnd() * 0.4);
      const rot = rnd() * Math.PI;
      const baseWidth = 3.5 + rnd() * 7;
      const lobes = rnd() < 0.22 ? 2 : 1; // occasional figure-eight

      // Low-frequency harmonic phases (smooth wobble, no jitter).
      const p1 = rnd() * 6.283;
      const p2 = rnd() * 6.283;
      const p3 = rnd() * 6.283;
      const amp1 = 0.16 + rnd() * 0.14;
      const amp2 = 0.08 + rnd() * 0.08;

      // Sweep: how much of a full circle this stroke covers (open arc).
      const sweep = 0.5 + rnd() * 0.5; // 180deg..360deg
      const startAng = rnd() * Math.PI * 2;
      strokes.push({ cx, cy, loopR, loopRy, rot, baseWidth, lobes, p1, p2, p3, amp1, amp2, rr, phase: rnd(), sweep, startAng });
    }
    strokes.sort((a, b) => a.rr - b.rr);
  }

  // Sample the loop as a smooth closed path. Uses coherent 1D value-noise
  // (smooth interpolation between random anchors) so the curve is irregular
  // and hand-drawn but never jagged.
  function makeNoise1D(seedVal, count) {
    const anchors = [];
    const rnd = mulberry32(seedVal);
    for (let i = 0; i < count; i++) anchors.push(rnd());
    return function (t) {
      // t in [0,1); smooth periodic interpolation between anchors
      const x = ((t % 1) + 1) % 1 * (anchors.length - 1);
      const i = Math.floor(x);
      const f = x - i;
      const a = anchors[i];
      const b = anchors[(i + 1) % anchors.length];
      // smoothstep
      const u = f * f * (3 - 2 * f);
      return a + (b - a) * u;
    };
  }

  function sampleLoop(st, steps) {
    const noise = makeNoise1D(seed ^ Math.floor(st.cx * 1000 + st.cy), 6);
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = (i / steps);
      const ang = st.startAng + t * Math.PI * 2 * st.sweep;
      // radius modulation: harmonics + coherent noise (organic irregularity)
      const nzv = (noise(t) - 0.5) * 2; // -1..1
      const rad = 1
        + st.amp1 * Math.sin(ang * 2 + st.p1)
        + st.amp2 * Math.sin(ang * 4 + st.p2)
        + 0.18 * nzv;
      let px, py;
      if (st.lobes === 1) {
        px = Math.cos(ang) * st.loopR * rad;
        py = Math.sin(ang) * st.loopRy * rad;
      } else {
        const s2 = Math.sin(ang), c2 = Math.cos(ang);
        px = (st.loopR * rad * c2);
        py = (st.loopRy * rad * s2) * 1.6;
      }
      const cr = Math.cos(st.rot), sr = Math.sin(st.rot);
      pts.push({
        x: st.cx + px * cr - py * sr,
        y: st.cy + px * sr + py * cr,
      });
    }
    return pts;
  }

  // Convert sampled points to a smooth closed path using Catmull-Rom -> cubic
  // Bezier so the curve is C1-smooth with no corners, then stroke with taper.
  function strokeSmoothLoop(pts, width, alpha) {
    const n = pts.length;
    if (n < 3) return;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;

    // Closed loop -> wrap the 3 extra control points.
    const drawPts = [pts[n - 2], pts[0], pts[1], ...pts.slice(2), pts[0], pts[1]];

    for (let i = 0; i < n; i++) {
      const p0 = drawPts[i];
      const p1 = drawPts[i + 1];
      const p2 = drawPts[i + 2];
      const p3 = drawPts[i + 3];
      // Catmull-Rom tangents
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;

      // taper envelope: near-zero at tips, full in the middle (pen physics)
      const midT = i / n;
      const env = Math.sin(Math.PI * midT);
      const w = Math.max(0.35, width * (0.25 + 0.75 * env));

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
      ctx.lineWidth = w;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function syncCanvasSize() {
    const rect = base.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.left = '0px';
    canvas.style.top = '0px';
    ctx.setTransform((w / W) * dpr, 0, 0, (h / H) * dpr, 0, 0);
  }

  function drawAt(openness) {
    syncCanvasSize();
    ctx.clearRect(0, 0, W, H);
    if (openness <= 0.001) return;

    // Frames are cheap: fixed ~24 steps per loop, drawn only up to reveal.
    for (let i = 0; i < strokes.length; i++) {
      const st = strokes[i];
      const start = st.rr * 0.8;
      const end = start + 0.28;
      const local = Math.max(0, Math.min(1, (openness - start) / Math.max(0.0001, end - start)));
      if (local <= 0) continue;

      const steps = 14 + Math.floor(5 * st.phase);
      const pts = sampleLoop(st, steps);
      const alpha = 0.22 + 0.5 * local;
      const w = st.baseWidth * (0.5 + 0.5 * local);
      strokeSmoothLoop(pts, w, alpha);
    }
  }

  function setOpenness(v) {
    const o = Math.max(0, Math.min(1, v));
    if (o > 0.01 && lastOpenness <= 0.01) {
      seed = Math.floor(Math.random() * 0xFFFFFFFF);
      buildStrokes();
    }
    lastOpenness = o;
    drawAt(o);
  }

  buildStrokes();

  const ro = new ResizeObserver(() => { if (lastOpenness >= 0) drawAt(lastOpenness); });
  ro.observe(base);
  window.addEventListener('resize', () => { if (lastOpenness >= 0) drawAt(lastOpenness); });

  return { setOpenness, canvas };
}
