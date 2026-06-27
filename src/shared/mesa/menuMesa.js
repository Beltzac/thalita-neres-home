export function initMenuMesa(config) {
  const {
    CURSOR_NORMAL = 'url("/assets/cursors/cursor-normal.ico") 32 0, auto',
    CURSOR_HOVER = 'url("/assets/cursors/cursor-hover.ico") 32 0, pointer',
    CURSOR_GRAB = 'grabbing',
    DRAG_THRESHOLD = 4,
    globalScale = 0.15,
    layoutBounds: configuredLayoutBounds = null,
    items = [],
  } = config;

  const baseZIndex = items.reduce((max, item) => {
    const value = Number.isFinite(item.zIndex) ? item.zIndex : 0;
    return value > max ? value : max;
  }, 1);

  let mesaContainer,
    renderedItems = [],
    dragState = null,
    lastActiveIndex = -1,
    layoutBounds = { maxX: 1, maxY: 1 },
    zCounter = baseZIndex,
    popped = null; // { index, backdrop, wrap, label, fromRect }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load: ${src}`));
      img.src = src;
    });
  }

  // ── popup (uses real item element) ──────────────────────

  function popIn(index) {
    if (popped) return;
    const entry = renderedItems[index];
    const item = items[index];
    const wrapper = entry.wrapper;

    // capture current rect + inline position
    const fromRect = wrapper.getBoundingClientRect();
    const savedLeft = wrapper.style.left;
    const savedTop = wrapper.style.top;
    const savedWidth = wrapper.style.width;
    const savedHeight = wrapper.style.height;

    // backdrop
    const backdrop = document.createElement('div');
    backdrop.classList.add('mesa-lightbox-backdrop');

    // wrap for positioning the item + label
    const wrap = document.createElement('div');
    wrap.classList.add('mesa-lightbox-wrap');
    wrap.style.position = 'fixed';
    wrap.style.left = fromRect.left + 'px';
    wrap.style.top = fromRect.top + 'px';
    wrap.style.width = fromRect.width + 'px';
    wrap.style.height = fromRect.height + 'px';

    // reparent the actual wrapper into the popup
    wrapper.style.position = 'absolute';
    wrapper.style.left = '0';
    wrapper.style.top = '0';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.transition = 'none';
    wrapper.classList.remove('mesa-hovered');
    // remove tilt during zoom
    const inner = wrapper.querySelector('.mesa-item-inner');
    if (inner) inner.style.transform = '';
    wrap.appendChild(wrapper);

    // label
    let labelEl = null;
    backdrop.appendChild(wrap);
    document.body.appendChild(backdrop);

    // compute target rect (centered, max 85vw x 70vh, keep aspect)
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const aspect = entry.naturalW / entry.naturalH;
    const maxW = vw * 0.92;
    const maxH = vh * 0.88;
    let targetW = maxW;
    let targetH = targetW / aspect;
    if (targetH > maxH) {
      targetH = maxH;
      targetW = targetH * aspect;
    }
    const targetLeft = (vw - targetW) / 2;
    const targetTop = (vh - targetH) / 2;

    // ── zoom + pan (origin 0 0 for predictable math) ──
    let zoomLevel = 1;
    let targetZoom = 1;
    let panX = 0, panY = 0;
    let targetPanX = 0, targetPanY = 0;
    let rafId = null;
    let backdropPointer = null; // { startX, startY, startPanX, startPanY, dragging }

    wrapper.style.transformOrigin = '0 0';

    function applyTransform() {
      wrapper.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomLevel})`;
    }

    function animateZoom() {
      const dz = targetZoom - zoomLevel;
      const dpx = targetPanX - panX;
      const dpy = targetPanY - panY;
      const done = Math.abs(dz) < 0.0005 && Math.abs(dpx) < 0.05 && Math.abs(dpy) < 0.05;
      if (done) {
        zoomLevel = targetZoom;
        panX = targetPanX;
        panY = targetPanY;
        applyTransform();
        rafId = null;
        return;
      }
      zoomLevel += dz * 0.22;
      panX += dpx * 0.22;
      panY += dpy * 0.22;
      applyTransform();
      rafId = requestAnimationFrame(animateZoom);
    }

    const onWheel = (e) => {
      e.preventDefault();
      const wrapRect = wrap.getBoundingClientRect();

      // cursor relative to wrap top-left
      const cx = e.clientX - wrapRect.left;
      const cy = e.clientY - wrapRect.top;

      // wrapper-local coordinate under cursor
      const lx = (cx - targetPanX) / targetZoom;
      const ly = (cy - targetPanY) / targetZoom;

      // new target zoom
      targetZoom = Math.max(0.5, Math.min(5, targetZoom - e.deltaY * 0.003));

      // adjust target pan so same wrapper-local point stays under cursor
      targetPanX = cx - lx * targetZoom;
      targetPanY = cy - ly * targetZoom;

      if (!rafId) rafId = requestAnimationFrame(animateZoom);
    };

    // pan on drag (cancels animation, syncs targets)
    const onBackdropPointerDown = (e) => {
      if (e.button !== 0) return;
      if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
      // sync targets to current animated values
      targetPanX = panX;
      targetPanY = panY;
      targetZoom = zoomLevel;
      backdropPointer = {
        startX: e.clientX, startY: e.clientY,
        startPanX: panX, startPanY: panY,
        dragging: false,
      };
      backdrop.setPointerCapture(e.pointerId);
      backdrop.style.cursor = CURSOR_GRAB;
      e.preventDefault();
    };

    const onBackdropPointerMove = (e) => {
      if (!backdropPointer) return;
      const dx = e.clientX - backdropPointer.startX;
      const dy = e.clientY - backdropPointer.startY;
      if (!backdropPointer.dragging && Math.abs(dx) + Math.abs(dy) > 3) {
        backdropPointer.dragging = true;
      }
      if (backdropPointer.dragging) {
        panX = targetPanX = backdropPointer.startPanX + dx;
        panY = targetPanY = backdropPointer.startPanY + dy;
        applyTransform();
      }
    };

    const onBackdropPointerUp = (e) => {
      if (!backdropPointer) return;
      backdrop.releasePointerCapture(e.pointerId);
      backdrop.style.cursor = CURSOR_NORMAL;
      const wasDrag = backdropPointer.dragging;
      backdropPointer = null;
      if (!wasDrag) popOut();
    };

    backdrop.addEventListener('wheel', onWheel, { passive: false });
    backdrop.addEventListener('pointerdown', onBackdropPointerDown);
    backdrop.addEventListener('pointermove', onBackdropPointerMove);
    backdrop.addEventListener('pointerup', onBackdropPointerUp);

    popped = { index, backdrop, wrap, wrapper, fromRect,
               savedLeft, savedTop, savedWidth, savedHeight,
               onWheel, onBackdropPointerDown, onBackdropPointerMove, onBackdropPointerUp,
               getRafId: () => rafId,
               target: { left: targetLeft, top: targetTop, width: targetW, height: targetH } };

    // trigger open animation
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        wrap.style.left = targetLeft + 'px';
        wrap.style.top = targetTop + 'px';
        wrap.style.width = targetW + 'px';
        wrap.style.height = targetH + 'px';
        backdrop.classList.add('mesa-lightbox-open');
      });
    });
  }

  function popOut() {
    if (!popped) return;
    const { backdrop, wrap, wrapper, fromRect, index,
            savedLeft, savedTop, savedWidth, savedHeight,
            onWheel, onBackdropPointerDown, onBackdropPointerMove, onBackdropPointerUp,
            getRafId } = popped;

    // cancel smooth zoom animation
    const rid = getRafId();
    if (rid) cancelAnimationFrame(rid);

    backdrop.removeEventListener('wheel', onWheel);
    backdrop.removeEventListener('pointerdown', onBackdropPointerDown);
    backdrop.removeEventListener('pointermove', onBackdropPointerMove);
    backdrop.removeEventListener('pointerup', onBackdropPointerUp);

    // reset transform + origin
    wrapper.style.transform = '';
    wrapper.style.transformOrigin = '';

    wrap.style.left = fromRect.left + 'px';
    wrap.style.top = fromRect.top + 'px';
    wrap.style.width = fromRect.width + 'px';
    wrap.style.height = fromRect.height + 'px';
    backdrop.classList.remove('mesa-lightbox-open');

    // after transition, reparent back and restore original inline position
    const onTransitionEnd = (e) => {
      if (e.target !== wrap) return;
      wrap.removeEventListener('transitionend', onTransitionEnd);
      if (!popped) return;

      mesaContainer.appendChild(wrapper);
      wrapper.style.position = 'absolute';
      wrapper.style.transform = '';
      wrapper.style.transformOrigin = '';
      wrapper.style.left = savedLeft;
      wrapper.style.top = savedTop;
      wrapper.style.width = savedWidth;
      wrapper.style.height = savedHeight;
      wrapper.style.transition = '';
      // restore tilt
      const renderedEntry = renderedItems[index];
      const tiltInner = wrapper.querySelector('.mesa-item-inner');
      if (tiltInner && renderedEntry && renderedEntry.tilt != null) {
        tiltInner.style.transform = `rotate(${renderedEntry.tilt}deg)`;
      }

      backdrop.remove();
      popped = null;
      setActiveIndex(-1);
    };

    wrap.addEventListener('transitionend', onTransitionEnd);
  }

  function onKeyDown(e) {
    if (e.key === 'Escape' && popped) {
      popOut();
    }
  }

  // ── hit / layout ────────────────────────────────────────

  function setActiveIndex(nextIndex) {
    if (nextIndex === lastActiveIndex) return;
    renderedItems.forEach((entry, i) => {
      if (!entry) return;
      entry.wrapper.classList.toggle('mesa-hovered', i === nextIndex);
    });
    mesaContainer.style.cursor = nextIndex >= 0 ? CURSOR_HOVER : CURSOR_NORMAL;
    lastActiveIndex = nextIndex;
  }

  function hitTest(x, y) {
    let closestIndex = -1;
    let closestDistance = Infinity;

    renderedItems.forEach((entry, i) => {
      if (!entry) return;
      if (popped && popped.index === i) return; // skip popped item
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
    if (popped && popped.index === index) return;

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
    renderedItems.forEach((entry, i) => { if (entry) layoutItem(entry, i); });
  }

  // ── pointer events ──────────────────────────────────────

  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (popped) return;
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
      // click → pop item up in-place (only if zoomable)
      const itemConfig = items[dragState.index];
      if (itemConfig.zoomable !== false) {
        popIn(dragState.index);
      }
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

  // ── init / destroy ──────────────────────────────────────

  async function init(container) {
    mesaContainer = container;
    mesaContainer.style.cursor = CURSOR_NORMAL;

    const xs = items.map(i => i.x ?? 0);
    const ys = items.map(i => i.y ?? 0);
    layoutBounds.maxX = Number.isFinite(configuredLayoutBounds?.maxX)
      ? configuredLayoutBounds.maxX
      : Math.max(...xs, 1);
    layoutBounds.maxY = Number.isFinite(configuredLayoutBounds?.maxY)
      ? configuredLayoutBounds.maxY
      : Math.max(...ys, 1);

    const loader = document.querySelector('.lds-facebook');
    const total = items.length;
    let loadedCount = 0;

    renderedItems = new Array(total);

    // Sort by y-position: above-fold items load first, rest still parallel
    const priority = items
      .map((item, i) => ({ item, origIndex: i }))
      .sort((a, b) => (a.item.y ?? 0) - (b.item.y ?? 0));

    const vh = window.innerHeight;
    const isAboveFold = (y) => (y ?? 0) < vh * 1.2;

    const loadOne = async ({ item, origIndex }) => {
      try {
        const img = await loadImage(item.src);

        const wrapper = document.createElement('div');
        wrapper.classList.add('mesa-item');
        wrapper.style.position = 'absolute';
        wrapper.style.width = '0px';
        wrapper.style.height = '0px';

        const tilt = (Math.random() - 0.5) * 30; // ±15deg

        const inner = document.createElement('div');
        inner.classList.add('mesa-item-inner');
        inner.style.width = '100%';
        inner.style.height = '100%';
        inner.style.transform = `rotate(${tilt}deg)`;

        const imgEl = document.createElement('img');
        imgEl.src = item.src;
        imgEl.draggable = false;
        imgEl.style.width = '100%';
        imgEl.style.height = '100%';
        imgEl.style.objectFit = 'contain';
        imgEl.style.pointerEvents = 'none';
        if (!isAboveFold(item.y)) imgEl.loading = 'lazy';

        inner.appendChild(imgEl);
        wrapper.appendChild(inner);
        mesaContainer.appendChild(wrapper);

        const itemZIndex = Number.isFinite(item.zIndex) ? item.zIndex : ++zCounter;
        wrapper.style.zIndex = itemZIndex;
        zCounter = Math.max(zCounter, itemZIndex);

        const entry = {
          item,
          wrapper,
          inner,
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          tilt,
        };
        renderedItems[origIndex] = entry;

        // Layout immediately — no waiting for others
        layoutItem(entry, origIndex);
      } catch (err) {
        console.error('Failed to load mesa item:', item.src, err);
      }

      loadedCount++;
      if (loadedCount >= total && loader) {
        loader.style.display = 'none';
      }
    };

    // Fire all loads in parallel; each renders as it completes
    await Promise.all(priority.map(loadOne));

    mesaContainer.addEventListener('pointerdown', onPointerDown);
    mesaContainer.addEventListener('pointermove', onPointerMove);
    mesaContainer.addEventListener('pointerup', onPointerUp);
    mesaContainer.addEventListener('pointerleave', onPointerLeave);
    window.addEventListener('resize', onResize);
    window.addEventListener('keydown', onKeyDown);
  }

  function destroy() {
    if (popped) {
      const { backdrop, wrap, wrapper, index } = popped;
      mesaContainer.appendChild(wrapper);
      wrapper.style.cssText = '';
      backdrop.remove();
      popped = null;
    }
    mesaContainer.removeEventListener('pointerdown', onPointerDown);
    mesaContainer.removeEventListener('pointermove', onPointerMove);
    mesaContainer.removeEventListener('pointerup', onPointerUp);
    mesaContainer.removeEventListener('pointerleave', onPointerLeave);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('keydown', onKeyDown);
    renderedItems = [];
    dragState = null;
  }

  return { init, destroy };
}
