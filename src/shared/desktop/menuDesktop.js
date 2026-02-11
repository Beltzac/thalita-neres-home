import { confettiExplosion } from '../utils/confetti.js';

export function initMenuDesktop(config) {
  const {
    CURSOR_NORMAL = 'url("/assets/cursors/cursor-normal.ico") 32 0, auto',
    CURSOR_HOVER = 'url("/assets/cursors/cursor-hover.ico") 32 0, pointer',
    labelStyle = 'classic',
    desktopItems = [],
  } = config;

  let desktopContainer, renderedItems, lastActiveIndex = -1;

  function setActiveIndex(nextIndex) {
    if (nextIndex === lastActiveIndex) return;

    renderedItems.forEach((entry, i) => {
      const isActive = i === nextIndex;
      entry.imgActive.style.opacity = isActive ? '1' : '0';
      entry.imgBase.style.opacity = isActive ? '0' : '1';
      entry.itemDiv.classList.toggle('hovered', isActive);
    });

    lastActiveIndex = nextIndex;
  }

  function updateActiveFromPointer(x, y) {
    let closestIndex = -1;
    let closestDistance = Infinity;

    renderedItems.forEach((entry, i) => {
      const rect = entry.iconWrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const radius = Math.min(rect.width, rect.height) / 2;

      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance <= radius && distance < closestDistance) {
        closestDistance = distance;
        closestIndex = i;
      }
    });

    setActiveIndex(closestIndex);
  }


  function init(container) {
    desktopContainer = container;
    desktopContainer.style.cursor = CURSOR_NORMAL;

    const loader = document.querySelector('.lds-facebook');
    if (loader) {
      loader.style.display = 'none';
    }

    renderedItems = [];

    desktopItems.forEach((item, index) => {
      const itemDiv = document.createElement('div');
      itemDiv.classList.add('desktop-item');

      const iconWrapper = document.createElement('div');
      iconWrapper.classList.add('icon-wrapper');

      const imgBase = document.createElement('img');
      imgBase.src = item.baseImage;
      imgBase.classList.add('desktop-icon', 'icon-base');

      const imgActive = document.createElement('img');
      imgActive.src = item.activeImage;
      imgActive.classList.add('desktop-icon', 'icon-active');

      iconWrapper.appendChild(imgBase);
      iconWrapper.appendChild(imgActive);

      const label = document.createElement('div');
      label.classList.add('icon-label');
      label.textContent = item.label;
      if (labelStyle === 'none') {
        label.style.display = 'none';
      }

      itemDiv.appendChild(iconWrapper);
      itemDiv.appendChild(label);
      desktopContainer.appendChild(itemDiv);

      renderedItems.push({
        item,
        itemDiv,
        iconWrapper,
        imgBase,
        imgActive
      });
    });

    desktopContainer.addEventListener('mousemove', (e) => {
      updateActiveFromPointer(e.clientX, e.clientY);
    });

    desktopContainer.addEventListener('mouseleave', () => {
      setActiveIndex(-1);
    });

    desktopContainer.addEventListener('mousedown', () => {
      if (lastActiveIndex < 0) return;
      document.querySelectorAll('.desktop-item').forEach(el => el.classList.remove('selected'));
      renderedItems[lastActiveIndex].itemDiv.classList.add('selected');
    });

    desktopContainer.addEventListener('click', () => {
      if (lastActiveIndex < 0) return;

      const entry = renderedItems[lastActiveIndex];
      const rect = entry.iconWrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      confettiExplosion(centerX, centerY);

      setTimeout(() => {
        window.parent.postMessage(entry.item.urlLink, "*");
        console.log('Url enviada:' + entry.item.urlLink);
      }, 500);
    });
  }

  return { init };
}
