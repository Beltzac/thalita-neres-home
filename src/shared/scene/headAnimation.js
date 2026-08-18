// Head-opening animation for the fwdlinks page.
//
// The head opens vertically: the top half (skull) slides up and the bottom
// half (jaw/neck) slides down, revealing a GPU-generated scribble (WebGL)
// BEHIND the head. The scribble has no defined center — it expands outward
// as openness rises. Menu badges fade in one-by-one as the head opens.
//
// Layering (back -> front): scribble canvas -> head halves -> badges.
import { initScribbleShader } from './scribbleShader.js';

export function initHeadAnimation({ container, headFrame, splitY = 0.6, badgeSelector, onOpen, onClose }) {
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
  let wasOpen = false;

  let headH = 0;
  function recalcSplit() {
    const h = base.style.height;
    headH = parseFloat(h) || (base.getBoundingClientRect().height || 0);
  }

  function syncSize() {
    const h = base.style.height;
    if (h) {
      topHalf.style.height = h;
      bottomHalf.style.height = h;
    }
    recalcSplit();
  }

  // Build an organic (wavy) split contour across the image width, so the
  // cut is curved and irregular rather than a straight horizontal line.
  // Returns: { forward: left->right points, reverse: right->left points }.
  function organicSplit() {
    const N = 24;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const x = i / (N - 1);
      const y = splitY
        + 0.04 * Math.sin(x * Math.PI * 3 + 1.7)
        + 0.022  * Math.sin(x * Math.PI * 7 + 0.6)
        + 0.014 * Math.sin(x * 23.0 + 4.2);
      pts.push(`${(x * 100).toFixed(2)}% ${(y * 100).toFixed(2)}%`);
    }
    return { forward: pts.join(', '), reverse: [...pts].reverse().join(', ') };
  }

  function applySplit(p) {
    if (!headH) return;
    const offset = p * headH * 0.18;
    const { forward, reverse } = organicSplit();

    // TOP half: top edge (0,0)->(100%,0), then split line right->left.
    topHalf.style.clipPath = `polygon(0% 0%, 100% 0%, ${reverse})`;
    // BOTTOM half: split line left->right, then bottom edge (100%,100%)->(0,100%).
    bottomHalf.style.clipPath = `polygon(${forward}, 100% 100%, 0% 100%)`;

    topHalf.style.transform = `translateY(${-offset}px)`;
    bottomHalf.style.transform = `translateY(${offset}px)`;
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

  function applyBadges(p) {
    // Each badge fades in at a successive openness threshold.
    const n = badges.length;
    badges.forEach((b, i) => {
      const start = 0.55 + (i / n) * 0.4; // 0.55 .. 0.95
      const local = Math.max(0, Math.min(1, (p - start) / 0.08));
      b.style.visibility = local > 0 ? 'visible' : 'hidden';
      b.style.opacity = String(local);
      b.style.pointerEvents = local >= 1 ? 'auto' : 'none';
    });
  }

  function render() {
    scribble.setOpenness(progress);
    applySplit(progress);
    applyBadges(progress);

    const isOpen = progress >= 0.99;
    if (isOpen && !wasOpen) {
      wasOpen = true;
      onOpen?.();
    } else if (!isOpen && wasOpen) {
      wasOpen = false;
      onClose?.();
    }
  }

  function tick() {
    rafId = null;
    const speed = 0.16;
    progress += (target - progress) * speed;
    if (Math.abs(target - progress) < 0.001) progress = target;
    render();
    if (Math.abs(target - progress) > 0.0005) {
      rafId = requestAnimationFrame(tick);
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
