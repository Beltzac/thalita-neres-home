import { confettiExplosion } from '../utils/confetti.js';

export function initMenuMesa(config) {
  const {
    CURSOR_NORMAL = 'url("/assets/cursors/cursor-normal.ico") 32 0, auto',
    CURSOR_HOVER = 'url("/assets/cursors/cursor-hover.ico") 32 0, pointer',
    CURSOR_GRAB = 'grabbing',
    DRAG_THRESHOLD = 4,
    globalScale = 0.15,
    items = [],
  } = config;

  let mesaContainer,
    renderedItems = [],
    dragState = null,
    lastActiveIndex = -1,
    layoutBounds = { maxX: 1, maxY: 1 },
    zCounter = 1;

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));
      img.src = src;
    });
  }

  function setActiveIndex(nextIndex) {
    if (nextIndex === lastActiveIndex) return;
    renderedItems.forEach((entry, i) => {
      entry.wrapper.classList.toggle('mesa-hovered', i === nextIndex);
    });
    mesaContainer.style.cursor = nextIndex >= 0 ? CURSOR_HOVER : CURSOR_NORMAL;
    lastActiveIndex = nextIndex;
  }

  function hitTest(x, y) {
    let closestIndex = -1;
    let closestDistance = Infinity;

    renderedItems.forEach((entry, i) => {
      const rect = entry.wrapper.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const rx = rect.width / 2;
      const ry = rect.height / 2;
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const dist = dx * dx + dy * dy;
      if (dist <= 1 && dist < closestDistance) {
        closestDistance = dist;
        closestIndex = i;
      }
    });

    return closestIndex;
  }

  function computeItemSize(itemScale) {
    const vmin = Math.min(window.innerWidth, window.innerHeight);
    const baseSize = vmin * globalScale;
    return baseSize * itemScale;
  }

  function layoutItem(entry, index) {
    if (dragState && dragState.index === index) return;

    const item = items[index];
    const itemScale = item.scale ?? 1;
    const h = computeItemSize(itemScale);
    const aspect = entry.naturalW / entry.naturalH;
    const w = h * aspect;

    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const normX = (item.x ?? 0) / layoutBounds.maxX;
    const normY = (item.y ?? 0) / layoutBounds.maxY;

    entry.wrapper.style.width = w + 'px';
    entry.wrapper.style.height = h + 'px';
    entry.wrapper.style.left = (normX * (vw - w)) + 'px';
    entry.wrapper.style.top = (normY * (vh - h)) + 'px';
  }

  function layoutAll() {
    renderedItems.forEach((entry, i) => layoutItem(entry, i));
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;
    const idx = hitTest(e.clientX, e.clientY);
    if (idx < 0) return;

    dragState = {
      index: idx,
      startX: e.clientX,
      startY: e.clientY,
      origLeft: renderedItems[idx].wrapper.offsetLeft,
      origTop: renderedItems[idx].wrapper.offsetTop,
      dragging: false,
    };

    renderedItems[idx].wrapper.style.zIndex = ++zCounter;
    renderedItems[idx].wrapper.style.transition = 'none';
    mesaContainer.style.cursor = CURSOR_GRAB;
    mesaContainer.setPointerCapture(e.pointerId);
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (dragState) {
      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;
      const dist = Math.hypot(dx, dy);

      if (!dragState.dragging && dist >= DRAG_THRESHOLD) {
        dragState.dragging = true;
        renderedItems[dragState.index].wrapper.classList.add('mesa-dragging');
      }

      if (dragState.dragging) {
        const wrapper = renderedItems[dragState.index].wrapper;
        wrapper.style.left = dragState.origLeft + dx + 'px';
        wrapper.style.top = dragState.origTop + dy + 'px';
      }
    } else {
      const idx = hitTest(e.clientX, e.clientY);
      setActiveIndex(idx);
    }
  }

  function onPointerUp(e) {
    if (!dragState) return;

    const entry = renderedItems[dragState.index];
    entry.wrapper.style.transition = '';
    entry.wrapper.classList.remove('mesa-dragging');

    if (dragState.dragging) {
      entry.wrapper.dataset.x = entry.wrapper.offsetLeft;
      entry.wrapper.dataset.y = entry.wrapper.offsetTop;
    } else {
      const rect = entry.wrapper.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      confettiExplosion(centerX, centerY);
      setTimeout(() => {
        window.parent.postMessage(entry.item.urlLink, '*');
      }, 500);
    }

    mesaContainer.style.cursor = CURSOR_NORMAL;
    if (dragState.index === lastActiveIndex) {
      setActiveIndex(-1);
    }
    mesaContainer.releasePointerCapture(e.pointerId);
    dragState = null;
  }

  function onPointerLeave(e) {
    if (dragState) return;
    setActiveIndex(-1);
  }

  function onResize() {
    layoutAll();
  }

  async function init(container) {
    mesaContainer = container;
    mesaContainer.style.cursor = CURSOR_NORMAL;

    // Compute layout bounds from item positions
    const xs = items.map(i => i.x ?? 0);
    const ys = items.map(i => i.y ?? 0);
    layoutBounds.maxX = Math.max(...xs, 1);
    layoutBounds.maxY = Math.max(...ys, 1);

    const loader = document.querySelector('.lds-facebook');
    const loadedCount = { value: 0 };
    const total = items.length;

    renderedItems = [];

    for (const item of items) {
      try {
        const img = await loadImage(item.src);

        const wrapper = document.createElement('div');
        wrapper.classList.add('mesa-item');
        wrapper.style.position = 'absolute';
        wrapper.style.width = '0px';
        wrapper.style.height = '0px';

        const imgEl = document.createElement('img');
        imgEl.src = item.src;
        imgEl.draggable = false;
        imgEl.style.width = '100%';
        imgEl.style.height = '100%';
        imgEl.style.objectFit = 'contain';
        imgEl.style.pointerEvents = 'none';

        wrapper.appendChild(imgEl);

        if (item.label) {
          const labelEl = document.createElement('div');
          labelEl.classList.add('mesa-label');
          labelEl.textContent = item.label;
          wrapper.appendChild(labelEl);
        }

        mesaContainer.appendChild(wrapper);

        const entry = {
          item,
          wrapper,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
        };
        renderedItems.push(entry);
      } catch (err) {
        console.error('Failed to load mesa item:', item.src, err);
      }

      loadedCount.value++;
      if (loadedCount.value >= total) {
        if (loader) loader.style.display = 'none';
        layoutAll();
      }
    }

    mesaContainer.addEventListener('pointerdown', onPointerDown);
    mesaContainer.addEventListener('pointermove', onPointerMove);
    mesaContainer.addEventListener('pointerup', onPointerUp);
    mesaContainer.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', onResize);
  }

  function destroy() {
    mesaContainer.removeEventListener('pointerdown', onPointerDown);
    mesaContainer.removeEventListener('pointermove', onPointerMove);
    mesaContainer.removeEventListener('pointerup', onPointerUp);
    mesaContainer.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    renderedItems = [];
    dragState = null;
  }

  return { init, destroy };
}
