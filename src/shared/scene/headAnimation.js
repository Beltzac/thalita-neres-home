// Head-opening animation for the cabeca page.
//
// The head opens vertically: the top half (skull) slides up and the bottom
// half (jaw/neck) slides down, revealing a GPU-generated scribble (WebGL)
// BEHIND the head. The scribble has no defined center — it expands outward
// as openness rises. Menu badges fade in one-by-one as the head opens.
//
// Layering (back -> front): scribble canvas -> head halves -> badges.
import { initScribbleShader } from './scribbleShader.js';

// Easing profiles for the opening gesture. Each maps normalized progress
// t in [0,1] to an "applied openness" that can briefly exceed 1 (overshoot)
// to make the head halves fly past the screen edges for an explosive pop.
const OPEN_CURVES = {
  // Original gentle linear ease (baseline).
  suave: (t) => t,
  // Fast, sharp snap to fully open (no overshoot).
  snap: (t) => 1 - Math.pow(1 - t, 2.2),
  // Mild pop: halves glide slightly past the edges, then settle.
  pop: (t) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // Strong explosion: halves fly well past the edges and snap back.
  explosao: (t) => {
    const c1 = 3.0;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // Bouncy elastic overshoot (oscillates past the target a few times).
  elastic: (t) => {
    if (t === 0 || t === 1) { return t; }
    const c4 = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  // Two-stage pop: quick first half, then a final overshoot bump.
  duplo: (t) => {
    if (t < 0.45) {
      return 0.66 * (t / 0.45);
    }
    const x = (t - 0.45) / 0.55;
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 0.66 + 0.34 * (1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2));
  },
  // Bouncy fall (monotonic) that jumps into place without overshooting past 1.
  bounce: (t) => {
    const n1 = 7.5625;
    const d1 = 2.75;
    if (t < 1 / d1) { return n1 * t * t; }
    if (t < 2 / d1) { return n1 * (t -= 1.5 / d1) * t + 0.75; }
    if (t < 2.5 / d1) { return n1 * (t -= 2.25 / d1) * t + 0.9375; }
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// Button entrance animations. Each maps reveal progress l (0..1, bounds-guarded)
// to an SVG transform applied around the button's own center, or null for a
// plain fade (no motion).
function easeOutBackK(l) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(l - 1, 3) + c1 * Math.pow(l - 1, 2);
}

const BUTTON_ANIMS = {
  fade: () => null,
  pop: (l) => `scale(${(0.82 + 0.18 * l).toFixed(3)}) rotate(${((1 - l) * 8).toFixed(1)})`,
  zoom: (l) => `scale(${(0.5 + 0.5 * easeOutBackK(l)).toFixed(3)})`,
  rise: (l) => `translate(0 ${((1 - l) * 140).toFixed(1)}) scale(${(0.85 + 0.15 * l).toFixed(3)})`,
  drop: (l) => `translate(0 ${((1 - l) * -140).toFixed(1)}) scale(${(0.85 + 0.15 * l).toFixed(3)})`,
  spin: (l) => `scale(${(0.75 + 0.25 * l).toFixed(3)}) rotate(${((1 - l) * 360).toFixed(1)})`,
  // Grow outward from the head/seam center (540, 960) to each button's home.
  centro: (l, cx, cy) => {
    const dx = 540 - cx;
    const dy = 960 - cy;
    return `translate(${(dx * (1 - l)).toFixed(1)} ${(dy * (1 - l)).toFixed(1)}) scale(${(0.3 + 0.7 * l).toFixed(3)})`;
  },
};

// Head-rotation profiles. Each maps applied openness a (0..~1.25) to the
// halves' rotation in degrees. All settle back to 0 when fully open, so the
// head never ends up permanently tilted. `a` is already bounds-guarded <= 1.25.
const HEAD_ROTATES = {
  nada: () => 0,
  abrir: (a) => 7 * Math.sin(Math.min(a, 1) * Math.PI),
  forte: (a) => 16 * Math.sin(Math.min(a, 1) * Math.PI),
  delicado: (a) => 4 * Math.sin(Math.min(a, 1) * Math.PI),
  bambolear: (a) => 6 * Math.sin(Math.min(a, 1) * Math.PI * 2) * Math.min(a, 1),
};

export function initHeadAnimation({ container, headFrame, splitY = 0.6, headContentTop = 0, headContentBottom = 1, badgeSelector, badgeCenters = null, animationSpeed = 0.16, onProgress, onOpen, onClose }) {
  const contentWrapper = container.querySelector('#contentWrapper');
  if (!contentWrapper) {
    console.error('headAnimation: #contentWrapper not found');
    return {};
  }

  const base = contentWrapper.querySelector('.imageLayer');
  if (!base) {
    console.error('headAnimation: base image not found');
    return {};
  }
  base.classList.add('headBaseImage');

  // ---- Scribble (WebGL) goes BEHIND everything ----
  const scribble = initScribbleShader({ container });

  // ---- Head: two halves split at splitY ----
  // TOP half (skull): clipped to 0..splitY, slides UP as it opens.
  const topHalf = document.createElement('img');
  topHalf.src = headFrame;
  topHalf.crossOrigin = 'anonymous';
  topHalf.draggable = false;
  topHalf.style.cssText =
    'position:absolute;left:0;top:0;width:auto;pointer-events:none;overflow:hidden;';
  topHalf.classList.add('headTop');
  contentWrapper.insertBefore(topHalf, base);

  // BOTTOM half (jaw): clipped to splitY..1, slides DOWN as it opens.
  const bottomHalf = document.createElement('img');
  bottomHalf.src = headFrame;
  bottomHalf.crossOrigin = 'anonymous';
  bottomHalf.draggable = false;
  bottomHalf.style.cssText =
    'position:absolute;left:0;top:0;width:auto;pointer-events:none;overflow:hidden;';
  bottomHalf.classList.add('headBottom');
  contentWrapper.insertBefore(bottomHalf, base);

  let progress = 0; // head-open clock (0 = closed, 1 = fully open)
  let rotateProgress = 0; // head-rotation clock
  let buttonProgress = 0; // button clock
  let target = 0;
  let curve = OPEN_CURVES.snap;
  let headRotate = HEAD_ROTATES.bambolear;
  let buttonAnim = BUTTON_ANIMS.centro;
  let headSpeed = animationSpeed;
  let rotateSpeed = 0.04;
  let buttonSpeed = 0.04;
  let rafId = null;
  let lastFrameTime = null;
  let wasOpen = false;

  let headH = 0;
  let topOpenOffset = 0;
  let bottomOpenOffset = 0;
  function recalcSplit() {
    const baseRect = base.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    headH = baseRect.height;
    scribble.setCenter?.(
      baseRect.left + baseRect.width / 2,
      baseRect.top + headH * splitY
    );
    topOpenOffset = Math.max(0, baseRect.top + headH * headContentTop - containerRect.top);
    bottomOpenOffset = Math.max(0, containerRect.bottom - (baseRect.top + headH * headContentBottom));
  }

  function syncSize() {
    const h = base.style.height;
    if (h) {
      topHalf.style.height = h;
      bottomHalf.style.height = h;
      badges.forEach((badge) => { badge.style.height = h; });
    }
    recalcSplit();
  }

  // Build a gentle arched contour that follows the shape of the skull.
  // Small, tapered variations keep it hand-drawn without making the cut jagged.
  function organicSplit() {
    const pointCount = 64;
    const points = [];
    for (let i = 0; i < pointCount; i++) {
      const x = i / (pointCount - 1);
      const envelope = Math.sin(x * Math.PI) ** 2;
      const arch = -0.024 * envelope;
      const texture = envelope * (
        0.018 * Math.sin(x * Math.PI * 3 + 1.2)
        + 0.008 * Math.sin(x * Math.PI * 7 + 0.6)
      );
      const y = splitY + arch + texture;
      points.push(`${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
    }
    return { forward: points.join(', '), reverse: [...points].reverse().join(', ') };
  }

  function applySplit(p, r) {
    if (!headH) return;
    const applied = Math.max(0, Math.min(1.25, curve(p)));
    const topOffset = applied * topOpenOffset;
    const bottomOffset = applied * bottomOpenOffset;
    const { forward, reverse } = organicSplit();

    // TOP half: top edge (0,0)->(100%,0), then split line right->left.
    topHalf.style.clipPath = `polygon(0% 0%, 100% 0%, ${reverse})`;
    // BOTTOM half: split line left->right, then bottom edge (100%,100%)->(0,100%).
    bottomHalf.style.clipPath = `polygon(${forward}, 100% 100%, 0% 100%)`;

    // Rotation follows its own independent clock so it can be tuned apart.
    const rotDeg = headRotate(Math.max(0, Math.min(1, r)));
    topHalf.style.transform = `translateY(${-topOffset}px) rotate(${-rotDeg}deg)`;
    bottomHalf.style.transform = `translateY(${bottomOffset}px) rotate(${rotDeg}deg)`;
  }

  // ---- Badges: stagger appearance one-by-one ----
  const badges = Array.from(contentWrapper.querySelectorAll(badgeSelector));
  function setBadgeInteraction(enabled) {
    badges.forEach((b) => {
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      if (!enabled) b.style.visibility = 'hidden';
    });
  }
  setBadgeInteraction(false);

  // Frame center in the head image's natural coordinate space (1080x1920).
  const FRAME_CX = 540;
  const FRAME_CY = 960;

  function distanceFromCenter(c) {
    if (!c) return Infinity;
    return Math.hypot(c[0] - FRAME_CX, c[1] - FRAME_CY);
  }

  function applyBadges(bp) {
    const n = badges.length;
    // Order badges by distance from the frame center so they appear
    // center-outward (closest first).
    const order = badges
      .map((b, i) => ({ i, d: distanceFromCenter(badgeCenters && badgeCenters[i]) }))
      .sort((a, b) => a.d - b.d);

    order.forEach((entry, rank) => {
      const b = badges[entry.i];
      const start = 0.5 + (rank / n) * 0.42; // 0.5 .. 0.92
      const local = Math.max(0, Math.min(1, (bp - start) / 0.07));
      b.style.visibility = local > 0 ? 'visible' : 'hidden';
      b.style.opacity = String(local);
      b.style.pointerEvents = local >= 1 ? 'auto' : 'none';

      // Apply the selected entrance motion around each button's own center.
      const rect = b.querySelector('rect');
      if (rect) {
        const cx = Number(rect.getAttribute('data-center-x'));
        const cy = Number(rect.getAttribute('data-center-y'));
        if (Number.isFinite(cx) && Number.isFinite(cy)) {
          const motion = buttonAnim(local, cx, cy);
          const transform = motion
            ? `translate(${cx} ${cy}) ${motion} translate(${-cx} ${-cy})`
            : '';
          b.querySelectorAll('rect,text').forEach((el) => el.setAttribute('transform', transform));
        }
      }
    });
  }

  function render() {
    scribble.setOpenness(progress);
    applySplit(progress, rotateProgress);
    applyBadges(buttonProgress);
    onProgress?.(progress);

    const isOpen = progress >= 0.99;
    if (isOpen && !wasOpen) {
      wasOpen = true;
      onOpen?.();
    } else if (!isOpen && wasOpen) {
      wasOpen = false;
      onClose?.();
    }
  }

  function tick(timestamp) {
    rafId = null;
    const frameDuration = 1000 / 60;
    const elapsedFrames = lastFrameTime === null
      ? 1
      : Math.min((timestamp - lastFrameTime) / frameDuration, 4);
    const step = (sp) => 1 - Math.pow(1 - sp, elapsedFrames);
    lastFrameTime = timestamp;

    const hstep = step(headSpeed);
    const rstep = step(rotateSpeed);
    const bstep = step(buttonSpeed);

    progress += (target - progress) * hstep;
    rotateProgress += (target - rotateProgress) * rstep;
    buttonProgress += (target - buttonProgress) * bstep;

    if (Math.abs(target - progress) < 0.001) { progress = target; }
    if (Math.abs(target - rotateProgress) < 0.001) { rotateProgress = target; }
    if (Math.abs(target - buttonProgress) < 0.001) { buttonProgress = target; }

    render();
    const moving = Math.abs(target - progress) > 0.0005
      || Math.abs(target - rotateProgress) > 0.0005
      || Math.abs(target - buttonProgress) > 0.0005;
    if (moving) {
      rafId = requestAnimationFrame(tick);
    } else {
      lastFrameTime = null;
    }
  }

  function setHover(on) {
    target = on ? 1 : 0;
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  function setOpenness(value) {
    target = Math.max(0, Math.min(1, value));
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  syncSize();
  const observer = new MutationObserver(() => syncSize());
  observer.observe(base, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', syncSize);

  requestAnimationFrame(() => { syncSize(); render(); });

  function setCurve(name) {
    curve = OPEN_CURVES[name] || OPEN_CURVES.suave;
    render();
  }

  function setButtonAnim(name) {
    buttonAnim = BUTTON_ANIMS[name] || BUTTON_ANIMS.pop;
    render();
  }

  function setHeadRotate(name) {
    headRotate = HEAD_ROTATES[name] || HEAD_ROTATES.abrir;
    render();
  }

  function clampSpeed(value) {
    const v = Number(value);
    if (!Number.isFinite(v)) { return 0.08; }
    return Math.max(0.01, Math.min(1, v));
  }

  function setHeadSpeed(value) { headSpeed = clampSpeed(value); render(); }
  function setRotateSpeed(value) { rotateSpeed = clampSpeed(value); render(); }
  function setButtonSpeed(value) { buttonSpeed = clampSpeed(value); render(); }

  return {
    setHover,
    setOpenness,
    setCurve,
    setHeadRotate,
    setButtonAnim,
    setHeadSpeed,
    setRotateSpeed,
    setButtonSpeed,
  };
}
