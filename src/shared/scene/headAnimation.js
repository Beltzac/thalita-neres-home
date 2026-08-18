// Head-opening animation for the fwdlinks page.
//
// The head opens vertically: the top half (skull) slides up and the bottom
// half (jaw/neck) slides down, revealing a GPU-generated scribble (WebGL)
// BEHIND the head. The scribble has no defined center — it expands outward
// as openness rises. Menu badges fade in one-by-one as the head opens.
//
// Layering (back -> front): scribble canvas -> head halves -> badges.
import { initScribbleShader } from './scribbleShader.js';

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

  let progress = 0; // 0 = closed, 1 = open
  let target = 0;
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

  function applySplit(p) {
    if (!headH) return;
    const topOffset = p * topOpenOffset;
    const bottomOffset = p * bottomOpenOffset;
    const { forward, reverse } = organicSplit();

    // TOP half: top edge (0,0)->(100%,0), then split line right->left.
    topHalf.style.clipPath = `polygon(0% 0%, 100% 0%, ${reverse})`;
    // BOTTOM half: split line left->right, then bottom edge (100%,100%)->(0,100%).
    bottomHalf.style.clipPath = `polygon(${forward}, 100% 100%, 0% 100%)`;

    topHalf.style.transform = `translateY(${-topOffset}px)`;
    bottomHalf.style.transform = `translateY(${bottomOffset}px)`;
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

  function applyBadges(p) {
    const n = badges.length;
    // Order badges by distance from the frame center so they appear
    // center-outward (closest first).
    const order = badges
      .map((b, i) => ({ i, d: distanceFromCenter(badgeCenters && badgeCenters[i]) }))
      .sort((a, b) => a.d - b.d);

    order.forEach((entry, rank) => {
      const b = badges[entry.i];
      const start = 0.5 + (rank / n) * 0.42; // 0.5 .. 0.92
      const local = Math.max(0, Math.min(1, (p - start) / 0.07));
      b.style.visibility = local > 0 ? 'visible' : 'hidden';
      b.style.opacity = String(local);
      b.style.pointerEvents = local >= 1 ? 'auto' : 'none';
    });
  }

  function render() {
    scribble.setOpenness(progress);
    applySplit(progress);
    applyBadges(progress);
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
    const frameSpeed = 1 - Math.pow(1 - animationSpeed, elapsedFrames);
    lastFrameTime = timestamp;
    progress += (target - progress) * frameSpeed;
    if (Math.abs(target - progress) < 0.001) progress = target;
    render();
    if (Math.abs(target - progress) > 0.0005) {
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

  return { setHover, setOpenness };
}
