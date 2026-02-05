export function confettiExplosion(x, y) {
  const numConfetti = 30;
  for (let i = 0; i < numConfetti; i++) {
    const confetti = document.createElement('div');
    confetti.classList.add('confetti');
    confetti.style.left = x + 'px';
    confetti.style.top = y + 'px';

    const size = Math.random() * 10 + 5;
    confetti.style.width = size + 'px';
    confetti.style.height = size + 'px';

    const angle = Math.random() * 2 * Math.PI;
    const distance = Math.random() * 250 + 50;
    const translateX = Math.cos(angle) * distance;
    const translateY = Math.sin(angle) * distance;
    confetti.style.setProperty('--translateX', translateX + 'px');
    confetti.style.setProperty('--translateY', translateY + 'px');

    const initialRotation = Math.random() * 360;
    confetti.style.transform = `rotate(${initialRotation}deg)`;

    const duration = Math.random() * 1 + 2.5;
    confetti.style.animationDuration = duration + 's';

    confetti.style.animationDelay = Math.random() * 0.2 + 's';

    confetti.style.backgroundColor = `hsl(${Math.floor(Math.random() * 360)}, 80%, 60%)`;

    document.body.appendChild(confetti);

    setTimeout(() => confetti.remove(), duration * 1000);
  }
}
