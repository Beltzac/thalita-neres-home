// Head-opening animation for the fwdlinks page.
// Crossfades the 4 head states (closed -> open) driven by mouse hover.
// Frames are appended INSIDE the scene engine's contentWrapper so they share
// the exact same coordinate system (position + scale) as the engine's base image.
//
// The scene engine continues to own badge visibility/hit-detection via its
// ACTIVE_RADIUS hover logic; this module only animates the head states and
// reports open/close so the page can gate navigation while still opening/closing.
export function initHeadAnimation({ container, frames, badgeSelector, onOpen, onClose }) {
  const frameEls = [];
  let progress = 0; // 0 = closed, 1 = open
  let target = 0;
  let rafId = null;
  let wasOpen = false;

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

  frames.forEach((src) => {
    const img = document.createElement('img');
    img.src = src;
    img.crossOrigin = 'anonymous';
    img.draggable = false;
    img.style.cssText =
      'position:absolute;left:0;top:0;width:auto;pointer-events:none;opacity:0;transition:opacity 0.25s ease;';
    contentWrapper.insertBefore(img, base);
    frameEls.push(img);
  });

  function syncSize() {
    const h = base.style.height;
    if (h) frameEls.forEach((img) => { img.style.height = h; });
  }

  // While closed, fully hide the badges (visibility) so the engine's hover
  // logic can't flash them over empty space before the head opens.
  const badges = contentWrapper.querySelectorAll(badgeSelector);
  function setBadgeInteraction(enabled) {
    badges.forEach((b) => {
      b.style.pointerEvents = enabled ? 'auto' : 'none';
      b.style.visibility = enabled ? 'visible' : 'hidden';
    });
  }
  setBadgeInteraction(false);

  function render() {
    const f = clamp(progress, 0, 1) * (frames.length - 1);
    const i0 = Math.floor(f);
    const i1 = Math.min(i0 + 1, frames.length - 1);
    const t = f - i0;

    frameEls.forEach((img, idx) => {
      let o = 0;
      if (idx === i0 && idx === i1) o = 1;
      else if (idx === i0) o = 1 - t;
      else if (idx === i1) o = t;
      img.style.opacity = o.toFixed(3);
    });

    const isOpen = progress >= 0.97;
    setBadgeInteraction(isOpen);
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
    const speed = 0.09;
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

  // Continuous openness target (0..1). Drives the same crossfade timeline,
  // so the head opens smoothly as the value approaches 1.
  function setOpenness(value) {
    target = clamp(value, 0, 1);
    if (rafId == null) rafId = requestAnimationFrame(tick);
  }

  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  syncSize();
  const observer = new MutationObserver(() => syncSize());
  observer.observe(base, { attributes: true, attributeFilter: ['style'] });
  window.addEventListener('resize', syncSize);

  // Ensure a first paint even before the base reports a height.
  requestAnimationFrame(() => { syncSize(); if (progress === 0) render(); });

  return { setHover, setOpenness };
}
