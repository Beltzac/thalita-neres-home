// Procedural "brain" scribble, drawn on a <canvas> at runtime.
// Grows organically out of the head's top as openness (0..1) increases,
// regenerating a slightly different shape each time it opens.
export function initScribble({ container, openTarget, baseSelector = '.headBaseImage' }) {
  const contentWrapper = container.querySelector('#contentWrapper');
  if (!contentWrapper) return {};

  const base = contentWrapper.querySelector(baseSelector);
  if (!base) return {};

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;';
  canvas.classList.add('scribbleLayer');
  // Insert ABOVE the head frame but BELOW the badge overlays.
  // The base image is the first child; put the canvas right after it.
  contentWrapper.insertBefore(canvas, base.nextSibling);

  const ctx = canvas.getContext('2d');

  // Scribble geometry is defined in the base image's natural coordinate
  // space (1080x1920); we render scaled to the canvas element.
  let W = 1080, H = 1920;

  // Head top (where scribbles emerge). Derived from the base head frame layout;
  // fallback to a sensible default if unknown.
  let originY = H * 0.775; // ~1489/1920
  let originX = W / 2;

  // Branch model: each branch is a list of points (x, y) with a thickness.
  let branches = [];
  let seed = 0;
  let lastOpenness = -1; // force first build

  function syncCanvasSize() {
    const rect = base.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    canvas.style.left = rect.left + 'px';
    canvas.style.top = rect.top + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return rect;
  }

  // Simple deterministic-but-seeded RNG so each open cycle differs,
  // yet a single cycle stays stable while drawing its frames.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Build the full (open) set of branches once per open cycle.
  function buildBranches() {
    branches = [];
    const rnd = mulberry32(seed);

    // A few "main tentacles" rising from the head top, fanning upward.
    const tentacles = 9 + Math.floor(rnd() * 5); // 9..13
    for (let t = 0; t < tentacles; t++) {
      const angle = -Math.PI / 2 + (rnd() - 0.5) * 1.6; // mostly upward
      const len = H * (0.18 + rnd() * 0.2);
      const steps = 40 + Math.floor(rnd() * 30);
      const pts = [];
      let x = originX + (rnd() - 0.5) * 120;
      let y = originY;
      let dx = Math.cos(angle);
      let dy = Math.sin(angle);
      for (let s = 0; s < steps; s++) {
        pts.push({ x, y });
        // wander: drift the heading with noise
        const wander = (rnd() - 0.5) * 0.35;
        const curAngle = Math.atan2(dy, dx) + wander;
        dx = Math.cos(curAngle);
        dy = Math.sin(curAngle);
        const step = len / steps;
        x += dx * step;
        y += dy * step;
      }
      branches.push({ pts, width: 1.5 + rnd() * 3.5, depth: rnd() });
    }

    // Add many short "hairs" branching from main tentacles for density.
    const hairs = 120 + Math.floor(rnd() * 90);
    for (let h = 0; h < hairs; h++) {
      const parent = branches[Math.floor(rnd() * tentacles)];
      if (!parent) continue;
      const startIdx = Math.floor(rnd() * parent.pts.length);
      const start = parent.pts[startIdx];
      const ha = -Math.PI / 2 + (rnd() - 0.5) * 2.4;
      const hlen = 40 + rnd() * 160;
      const hsteps = 8 + Math.floor(rnd() * 14);
      const pts = [];
      let x = start.x, y = start.y;
      let dx = Math.cos(ha), dy = Math.sin(ha);
      for (let s = 0; s < hsteps; s++) {
        pts.push({ x, y });
        const wa = Math.atan2(dy, dx) + (rnd() - 0.5) * 0.5;
        dx = Math.cos(wa); dy = Math.sin(wa);
        x += dx * (hlen / hsteps);
        y += dy * (hlen / hsteps);
      }
      branches.push({ pts, width: 0.7 + rnd() * 1.6, depth: rnd() });
    }

    // Sort shallow tentacles first (draw behind), hairs later.
    branches.sort((a, b) => a.depth - b.depth);
  }

  function drawAt(openness) {
    const rect = syncCanvasSize();
    ctx.clearRect(0, 0, rect.width, rect.height);
    if (openness <= 0.001) return;

    // Map openness to an amount of each branch to reveal (0..1 per-branch,
    // sequenced so growth looks sequential and organic).
    const reveal = clamp(openness, 0, 1);

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let i = 0; i < branches.length; i++) {
      const b = branches[i];
      // Per-branch reveal progress: spread across the openness range.
      const branchStart = (i / branches.length) * 0.92;
      const branchEnd = branchStart + (1 / branches.length) * 0.5 + 0.18;
      const local = clamp((reveal - branchStart) / Math.max(0.0001, branchEnd - branchStart), 0, 1);
      if (local <= 0) continue;

      const visibleCount = Math.max(2, Math.round(b.pts.length * local));
      const visible = b.pts.slice(0, visibleCount);

      ctx.strokeStyle = '#1f1f1f';
      ctx.lineWidth = b.width;
      ctx.globalAlpha = 0.25 + 0.75 * local;
      ctx.beginPath();
      visible.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function setOpenness(v) {
    const o = clamp(v, 0, 1);
    // Regenerate when the head opens from a fully closed state.
    if (o > 0.01 && lastOpenness <= 0.01) {
      seed = Math.floor(Math.random() * 0xFFFFFFFF);
      buildBranches();
    }
    lastOpenness = o;
    drawAt(o);
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  // Build an initial set so the canvas isn't empty pre-first-open.
  buildBranches();

  // Re-sync size when the base image resizes/re-lays-out.
  const ro = new ResizeObserver(() => { if (lastOpenness >= 0) drawAt(lastOpenness); });
  ro.observe(base);
  window.addEventListener('resize', () => { if (lastOpenness >= 0) drawAt(lastOpenness); });

  return { setOpenness, canvas };
}
