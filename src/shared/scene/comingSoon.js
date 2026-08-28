// "Coming soon" card used by menu overlays that are not wired to a real page yet.
// Instead of navigating (postMessage to the Wix host), the scene engine shows this
// sticker-like card, matching the hand-drawn badge style used across the site.

const STYLE_ID = 'comingSoonStyle';
const CARD_ID = 'comingSoonCard';
const DEFAULT_DURATION = 7000;
const DISMISS_ARM_DELAY = 120; // ignore the click that opened the card

const CSS = `
#${CARD_ID} {
  position: fixed;
  left: 50%;
  top: 50%;
  z-index: 2600;
  max-width: min(860px, 88vw);
  padding: 40px 54px 46px;
  background: #ffffff;
  border: 7px solid #292929;
  border-radius: 30px;
  box-shadow: 14px 16px 0 rgba(41, 41, 41, 0.85);
  color: #292929;
  font-family: 'Thata', sans-serif;
  text-align: center;
  opacity: 0;
  pointer-events: none;
  transform: translate(-50%, -50%) rotate(-1.2deg) scale(0.85);
  transition: opacity 200ms ease, transform 320ms cubic-bezier(0.2, 1.4, 0.4, 1);
}
#${CARD_ID}.isVisible {
  opacity: 1;
  transform: translate(-50%, -50%) rotate(-1.2deg) scale(1);
}
#${CARD_ID} .csTitle {
  font-size: clamp(38px, 7vh, 80px);
  font-weight: 700;
  letter-spacing: 0.5px;
}
#${CARD_ID} .csText {
  margin-top: 18px;
  font-size: clamp(22px, 3.9vh, 40px);
  line-height: 1.3;
  white-space: pre-line;
}
#${CARD_ID} .csHint {
  margin-top: 26px;
  font-size: clamp(15px, 2.3vh, 24px);
  opacity: 0.5;
}
`;

let hideTimer = null;
let armTimer = null;

function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

function getCard() {
  let card = document.getElementById(CARD_ID);
  if (card) return card;

  card = document.createElement('div');
  card.id = CARD_ID;
  card.setAttribute('role', 'status');
  card.innerHTML = '<div class="csTitle"></div><div class="csText"></div><div class="csHint"></div>';
  document.body.appendChild(card);
  return card;
}

function clearTimers() {
  if (hideTimer) window.clearTimeout(hideTimer);
  if (armTimer) window.clearTimeout(armTimer);
  hideTimer = null;
  armTimer = null;
}

function armDismiss() {
  window.addEventListener('pointerdown', hide, { capture: true });
  window.addEventListener('keydown', hide, { capture: true });
}

function disarmDismiss() {
  window.removeEventListener('pointerdown', hide, { capture: true });
  window.removeEventListener('keydown', hide, { capture: true });
}

export function hide() {
  disarmDismiss();
  clearTimers();
  const card = document.getElementById(CARD_ID);
  if (card) card.classList.remove('isVisible');
}

/**
 * @param {string|{title?: string, text?: string, hint?: string}} message
 * @param {{duration?: number}} [options]
 */
export function showComingSoon(message, { duration = DEFAULT_DURATION } = {}) {
  ensureStyle();
  const card = getCard();

  // A plain string becomes the body; its first line can act as the title.
  const spec = typeof message === 'string' ? { text: message } : (message || {});
  card.querySelector('.csTitle').textContent = spec.title || 'Em breve';
  card.querySelector('.csText').textContent = spec.text || '';
  card.querySelector('.csHint').textContent = spec.hint || 'clique em qualquer lugar para fechar';

  // Restart the animation when the card is already on screen.
  disarmDismiss();
  clearTimers();
  card.classList.remove('isVisible');
  void card.offsetWidth; // force reflow so the transition replays
  card.classList.add('isVisible');

  armTimer = window.setTimeout(() => {
    armDismiss();
    hideTimer = window.setTimeout(hide, duration);
  }, DISMISS_ARM_DELAY);
}
