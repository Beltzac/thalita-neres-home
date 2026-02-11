import { confettiExplosion } from '../utils/confetti.js';

export function initMenuScene(config) {
  const {
    baseUrl = "",
    baseImageFilename,
    margin = 60,
    CURSOR_NORMAL = 'url("/assets/cursors/cursor-normal.ico") 32 0, auto',
    CURSOR_HOVER = 'url("/assets/cursors/cursor-hover.ico") 32 0, pointer',
    ACTIVE_RADIUS = 500,
    precomputedCentersByUrl = {},
    overlayImages = [],
    labelMode = 'description',
    labelStyle = 'tooltip',
    arrowStartOffset = 300,
    arrowEndOffset = 20,
    labelFontSize = null,
    labelMaxWidth = null,
    instructionText = null,
    showArrow = false,
  } = config;

  let imageContainer, contentWrapper, baseImage, overlayElements, preProcessedOverlays;
  let lastClosestImageIndex = -1;
  let lastMinDistance = Infinity;
  let globalBaseCenter = null;
  let centersLogged = false;
  let loadedImages = 0;
  let totalImages = 0;

  function ensureGlobalArrowLayer() {
    let arrowLayer = document.getElementById('arrowLayer');
    if (arrowLayer) return arrowLayer;

    const svgNS = 'http://www.w3.org/2000/svg';
    arrowLayer = document.createElementNS(svgNS, 'svg');
    arrowLayer.setAttribute('id', 'arrowLayer');

    const defs = document.createElementNS(svgNS, 'defs');
    const marker = document.createElementNS(svgNS, 'marker');
    marker.setAttribute('id', 'arrowhead');
    marker.setAttribute('markerWidth', '6');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('refX', '0');
    marker.setAttribute('refY', '2');
    marker.setAttribute('orient', 'auto');

    const polygon = document.createElementNS(svgNS, 'polygon');
    polygon.setAttribute('points', '0 0, 6 2, 0 4');
    polygon.setAttribute('fill', '#1f1f1f');
    marker.appendChild(polygon);
    defs.appendChild(marker);

    const path = document.createElementNS(svgNS, 'path');
    path.setAttribute('id', 'dynamicArrow');
    path.setAttribute('class', 'hand-drawn-arrow');
    path.setAttribute('d', '');
    path.setAttribute('marker-end', 'url(#arrowhead)');

    arrowLayer.appendChild(defs);
    arrowLayer.appendChild(path);
    document.body.appendChild(arrowLayer);

    return arrowLayer;
  }

  function createAndAppendImage(src, zIndex, visible) {
    const img = document.createElement('img');
    img.crossOrigin = "anonymous";
    img.src = src;
    img.classList.add('imageLayer');
    img.style.zIndex = zIndex;
    img.style.display = visible ? '' : 'none';
    contentWrapper.appendChild(img);
    return img;
  }

  function normalizePrecomputeKey(value) {
    if (!value) return '';
    const clean = value.split('#')[0].split('?')[0];

    // Handle absolute URLs (e.g. https://domain.com/home/imagens/base.png)
    try {
      const parsed = new URL(clean, window.location.origin);
      const pathname = decodeURIComponent(parsed.pathname || clean);
      return pathname.replace(/^\/+/, '').replace(/^\.\//, '');
    } catch {
      return decodeURIComponent(clean).replace(/^\/+/, '').replace(/^\.\//, '');
    }
  }

  function resolvePrecomputedCenter(key) {
    if (!key) return null;

    if (precomputedCentersByUrl[key]) {
      return precomputedCentersByUrl[key];
    }

    // Absolute URL -> pathname (with leading slash)
    try {
      const parsed = new URL(key, window.location.origin);
      const pathname = decodeURIComponent(parsed.pathname || '');
      if (pathname && precomputedCentersByUrl[pathname]) {
        return precomputedCentersByUrl[pathname];
      }
    } catch {
      // ignore malformed URL and continue fallback normalization
    }

    const normalized = normalizePrecomputeKey(key);
    if (normalized && precomputedCentersByUrl[normalized]) {
      return precomputedCentersByUrl[normalized];
    }

    return null;
  }

  function preProcessOverlays(overlay) {
    const key = overlay.src || overlay.currentSrc || '';
    const precomputed = resolvePrecomputedCenter(key);

    if (precomputed) {
      console.log('Using precomputed center data for image:', key, precomputed);
      return precomputed;
    }

    const normalized = normalizePrecomputeKey(key);
    const error = `Missing precomputed center data for image: ${key || '(empty src)'} (normalized: ${normalized || '(empty)'})`;
    console.error(error);
    throw new Error(error);
  }

  function centerMenu(baseCenter) {
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    const availableWidth = viewportWidth;
    const availableHeight = viewportHeight - (2 * margin);

    const scaleX = availableWidth / baseCenter.contentWidth;
    const scaleY = availableHeight / baseCenter.contentHeight;
    const scale = Math.min(scaleX, scaleY);

    const targetHeight = baseCenter.height * scale;
    baseImage.style.height = targetHeight + "px";
    baseImage.style.width = "auto";

    overlayElements.forEach(img => {
      img.style.height = targetHeight + "px";
      img.style.width = "auto";
    });

    const scaledCenterX = baseCenter.bboxCenterX * scale;
    const scaledCenterY = baseCenter.bboxCenterY * scale;

    const offsetX = (viewportWidth / 2) - scaledCenterX;
    const offsetY = (viewportHeight / 2) - scaledCenterY;

    contentWrapper.style.transform = `translate(${offsetX}px, ${offsetY}px)`;
  }

  function findClosestImage(overlayElements, x, y) {
    lastClosestImageIndex = -1;
    let minDistance = Infinity;

    const style = window.getComputedStyle(contentWrapper);
    const matrix = new WebKitCSSMatrix(style.transform);
    const offsetX = matrix.m41;
    const offsetY = matrix.m42;

    const localX = x - offsetX;
    const localY = y - offsetY;

    const boundingBox = baseImage.getBoundingClientRect();
    const refWidth = preProcessedOverlays[0] ? preProcessedOverlays[0].width : baseImage.naturalWidth;
    const refHeight = preProcessedOverlays[0] ? preProcessedOverlays[0].height : baseImage.naturalHeight;

    const scaleX = refWidth / boundingBox.width;
    const scaleY = refHeight / boundingBox.height;

    const scaledX = localX * scaleX;
    const scaledY = localY * scaleY;

    for (let i = 0; i < overlayElements.length; i++) {
      const preProcessed = preProcessedOverlays[i];
      const dx = scaledX - preProcessed.centerX;
      const dy = scaledY - preProcessed.centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < minDistance) {
        minDistance = distance;
        lastClosestImageIndex = i;
      }

      overlayElements[i].style.display = 'none';
    }

    lastMinDistance = minDistance;

    const isActive = (lastClosestImageIndex >= 0) && (minDistance <= ACTIVE_RADIUS);

    if (isActive) {
      overlayElements[lastClosestImageIndex].style.display = '';
    } else {
      lastClosestImageIndex = -1;
    }

    return isActive;
  }

  function changeCursor(isActive) {
    imageContainer.style.cursor = isActive ? CURSOR_HOVER : CURSOR_NORMAL;
  }

  function showName(name, x, y) {
    const nameContainer = document.getElementById('objectDescription');

    nameContainer.classList.remove('label-side', 'label-horizontal');
    nameContainer.classList.add('label-tooltip');

    if (labelFontSize) nameContainer.style.fontSize = labelFontSize;
    if (labelMaxWidth) nameContainer.style.maxWidth = labelMaxWidth;

    if (!name) {
      nameContainer.style.display = 'none';
      return;
    }

    nameContainer.textContent = name;

    const halfDescriptionHeight = nameContainer.offsetHeight / 2;
    const halfDescriptionWidth = nameContainer.offsetWidth / 2;
    const verticalOffset = 50;
    const borderOffset = 10;

    const adjustedX = x;
    const adjustedY = y;

    nameContainer.style.left = (adjustedX - halfDescriptionWidth) + 'px';

    if (adjustedY - verticalOffset - halfDescriptionHeight - borderOffset < 0) {
      nameContainer.style.top = (adjustedY - halfDescriptionHeight + verticalOffset) + 'px';
    } else {
      nameContainer.style.top = (adjustedY - halfDescriptionHeight - verticalOffset) + 'px';
    }

    nameContainer.style.display = 'block';
  }

  function resolveLabelText(name, desc) {
    switch (labelMode) {
      case 'none':
        return null;
      case 'name':
        return name;
      case 'descriptionOrName':
        return desc || name;
      case 'nameOrDescription':
        return name || desc;
      case 'description':
      default:
        return desc;
    }
  }

  function getScreenCoordinates(preProcessed) {
    const style = window.getComputedStyle(contentWrapper);
    const matrix = new WebKitCSSMatrix(style.transform);
    const offsetX = matrix.m41;
    const offsetY = matrix.m42;

    const boundingBox = baseImage.getBoundingClientRect();
    const refWidth = preProcessedOverlays[0] ? preProcessedOverlays[0].width : baseImage.naturalWidth;
    const refHeight = preProcessedOverlays[0] ? preProcessedOverlays[0].height : baseImage.naturalHeight;

    const scaleX = boundingBox.width / refWidth;
    const scaleY = boundingBox.height / refHeight;

    const bboxCenterX = preProcessed.bboxCenterX;
    const bboxCenterY = preProcessed.bboxCenterY;
    const halfWidth = preProcessed.contentWidth / 2;
    const halfHeight = preProcessed.contentHeight / 2;

    const centerX = (bboxCenterX * scaleX) + offsetX;
    const centerY = (bboxCenterY * scaleY) + offsetY;

    const leftX = ((bboxCenterX - halfWidth) * scaleX) + offsetX;
    const rightX = ((bboxCenterX + halfWidth) * scaleX) + offsetX;
    const topY = ((bboxCenterY - halfHeight) * scaleY) + offsetY;
    const bottomY = ((bboxCenterY + halfHeight) * scaleY) + offsetY;

    return { x: centerX, y: centerY, leftX, rightX, topY, bottomY };
  }

  function drawArrow(targetX, targetY, overlayIndex) {
    if (!showArrow) return;

    const arrowPath = document.getElementById('dynamicArrow');
    if (!arrowPath) return;

    const overlay = overlayImages[overlayIndex];
    const preProcessed = preProcessedOverlays[overlayIndex];

    const coords = getScreenCoordinates(preProcessed);
    const startY = coords.y;

    const nameContainer = document.getElementById('objectDescription');
    const viewportWidth = window.innerWidth;
    const marginSide = 20;

    const seed = overlay.nomeImagem ? overlay.nomeImagem.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
    const onRightSide = (seed % 2 === 0);

    let textX, textY;
    if (onRightSide) {
      nameContainer.style.left = 'auto';
      nameContainer.style.right = marginSide + 'px';
      nameContainer.style.top = (targetY) + 'px';
      nameContainer.style.textAlign = 'right';
      textX = viewportWidth - marginSide - nameContainer.offsetWidth;
      textY = targetY + (nameContainer.offsetHeight / 2);
    } else {
      nameContainer.style.right = 'auto';
      nameContainer.style.left = marginSide + 'px';
      nameContainer.style.top = (targetY) + 'px';
      nameContainer.style.textAlign = 'left';
      textX = marginSide + nameContainer.offsetWidth;
      textY = targetY + (nameContainer.offsetHeight / 2);
    }

    const boundingBox = baseImage.getBoundingClientRect();
    const currentScale = baseImage.naturalWidth ? (boundingBox.width / baseImage.naturalWidth) : 1;

    const baseTextOffset = overlay.arrowEndOffset ?? arrowEndOffset;
    const gapText = baseTextOffset * currentScale;
    const baseMenuOffset = overlay.arrowStartOffset ?? arrowStartOffset;
    const gapMenu = baseMenuOffset * currentScale;

    const endX = onRightSide ? textX - gapText : textX + gapText;
    const endY = textY;

    const baseStartX = onRightSide ? coords.rightX : coords.leftX;
    const adjustedStartX = onRightSide ? baseStartX + gapMenu : baseStartX - gapMenu;
    const adjustedStartY = startY;

    const deltaX = endX - adjustedStartX;
    const cp1X = adjustedStartX + (deltaX * 0.5);
    const cp1Y = adjustedStartY;
    const cp2X = endX - (deltaX * 0.5);
    const cp2Y = endY;

    const pathData = `M ${adjustedStartX} ${adjustedStartY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
    arrowPath.setAttribute('d', pathData);
  }

  function showNameWithArrow(name, desc, mouseX, mouseY, targetX, targetY, isActive) {
    const nameContainer = document.getElementById('objectDescription');
    const arrowPath = document.getElementById('dynamicArrow');
    const labelText = resolveLabelText(name, desc);

    nameContainer.classList.remove('label-tooltip', 'label-side', 'label-horizontal');
    if (labelStyle === 'horizontal') {
      nameContainer.classList.add('label-horizontal');
    } else {
      nameContainer.classList.add('label-side');
    }

    if (labelFontSize) nameContainer.style.fontSize = labelFontSize;
    if (labelMaxWidth) nameContainer.style.maxWidth = labelMaxWidth;

    if (!labelText || !isActive) {
      nameContainer.style.display = 'none';
      if (arrowPath) arrowPath.setAttribute('d', '');
      return;
    }

    nameContainer.textContent = labelText;
    nameContainer.style.display = 'block';

    if (labelStyle === 'horizontal') {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const margin = 20;

      const seed = name ? name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
      const onTop = (seed % 2 === 0);

      const rotation = (Math.sin(seed) * 10);
      nameContainer.style.transform = `rotate(${rotation}deg)`;

      const randomOffsetX = Math.sin(seed) * (viewportWidth * 0.2);
      let left = (targetX - (nameContainer.offsetWidth / 2)) + randomOffsetX;
      const minLeft = margin;
      const maxLeft = Math.max(margin, viewportWidth - nameContainer.offsetWidth - margin);
      if (left < minLeft) left = minLeft;
      if (left > maxLeft) left = maxLeft;

      const top = onTop
        ? margin
        : viewportHeight - nameContainer.offsetHeight - margin;

      nameContainer.style.left = left + 'px';
      nameContainer.style.right = 'auto';
      nameContainer.style.top = top + 'px';
      nameContainer.style.textAlign = 'center';

      if (showArrow && arrowPath) {
        const overlayData = overlayImages[lastClosestImageIndex];
        const preProcessed = preProcessedOverlays[lastClosestImageIndex];
        const coords = preProcessed ? getScreenCoordinates(preProcessed) : { x: targetX, y: targetY, topY: targetY, bottomY: targetY };

        const boundingBox = baseImage.getBoundingClientRect();
        const currentScale = baseImage.naturalWidth ? (boundingBox.width / baseImage.naturalWidth) : 1;

        const overlay = overlayData || {};
        const baseTextOffset = overlay.arrowEndOffset ?? arrowEndOffset;
        const gapText = baseTextOffset * currentScale;
        const baseMenuOffset = overlay.arrowStartOffset ?? arrowStartOffset;
        const gapMenu = baseMenuOffset * currentScale;

        const textAnchorX = left + (nameContainer.offsetWidth / 2);
        const textAnchorY = onTop
          ? (top + nameContainer.offsetHeight + gapText)
          : (top - gapText);

        const baseStartY = onTop ? coords.topY : coords.bottomY;
        const adjustedStartY = onTop ? (baseStartY - gapMenu) : (baseStartY + gapMenu);
        const adjustedStartX = coords.x;

        const deltaY = textAnchorY - adjustedStartY;
        const cp1X = adjustedStartX;
        const cp1Y = adjustedStartY + (deltaY * 0.5);
        const cp2X = textAnchorX;
        const cp2Y = textAnchorY - (deltaY * 0.5);

        const pathData = `M ${adjustedStartX} ${adjustedStartY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${textAnchorX} ${textAnchorY}`;
        arrowPath.setAttribute('d', pathData);
      }

      return;
    }

    const viewportWidth = window.innerWidth;
    const marginSide = 20;
    const seed = name ? name.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) : 0;
    const rotation = (Math.sin(seed) * 10);
    nameContainer.style.transform = `rotate(${rotation}deg)`;

    const randomOffset = Math.sin(seed) * (window.innerHeight * 0.2);
    let textTop = targetY + randomOffset;
    const minTop = window.innerHeight * 0.1;
    const maxTop = window.innerHeight * 0.8;
    if (textTop < minTop) textTop = minTop;
    if (textTop > maxTop) textTop = maxTop;

    const onRightSide = (seed % 2 === 0);

    if (onRightSide) {
      nameContainer.style.left = 'auto';
      nameContainer.style.right = marginSide + 'px';
      nameContainer.style.top = textTop + 'px';
      nameContainer.style.textAlign = 'right';
    } else {
      nameContainer.style.right = 'auto';
      nameContainer.style.left = marginSide + 'px';
      nameContainer.style.top = textTop + 'px';
      nameContainer.style.textAlign = 'left';
    }

    if (showArrow) {
      drawArrow(targetX, targetY, lastClosestImageIndex);
    }
  }

  function checkAllLoaded() {
    if (loadedImages === totalImages) {
      setupImagesEvents();
      document.querySelector('.lds-facebook').style.display = 'none';

      if (!centersLogged) {
        centersLogged = true;
        const exportMap = {};

        if (globalBaseCenter && baseImage && baseImage.src) {
          exportMap[baseImage.src] = globalBaseCenter;
        }

        overlayImages.forEach((overlay, index) => {
          const data = preProcessedOverlays[index];
          if (data) {
            const key = baseUrl + overlay.arquivo;
            exportMap[key] = data;
          }
        });

        console.log('precomputedCentersByUrl JSON:', JSON.stringify(exportMap));
      }
    }
  }

  function setupImagesEvents() {
    imageContainer.addEventListener('mousemove', function (e) {
      const isActive = findClosestImage(overlayElements, e.clientX, e.clientY);
      const arrowPath = document.getElementById('dynamicArrow');

      if (isActive && lastClosestImageIndex !== -1) {
        const preProcessed = preProcessedOverlays[lastClosestImageIndex];
        const coords = getScreenCoordinates(preProcessed);
        const targetX = coords.x;
        const targetY = coords.y;
        const imageName = overlayImages[lastClosestImageIndex]?.nomeImagem;
        const imageDesc = overlayImages[lastClosestImageIndex]?.description;
        const labelText = resolveLabelText(imageName, imageDesc);
        changeCursor(isActive);

        if (labelStyle === 'side' || labelStyle === 'horizontal') {
          showNameWithArrow(imageName, imageDesc, e.clientX, e.clientY, targetX, targetY, isActive);
        } else {
          showName(labelText, e.clientX, e.clientY);
          if (arrowPath) arrowPath.setAttribute('d', '');
        }
      } else {
        changeCursor(isActive);
        if (labelStyle === 'side' || labelStyle === 'horizontal') {
          showNameWithArrow(null, null, e.clientX, e.clientY, 0, 0, false);
        } else {
          showName(null, e.clientX, e.clientY);
          if (arrowPath) arrowPath.setAttribute('d', '');
        }
      }
    });

    imageContainer.addEventListener('click', function () {
      if (lastClosestImageIndex < 0 || lastMinDistance > ACTIVE_RADIUS) return;

      const overlay = overlayImages[lastClosestImageIndex];
      const preProcessed = preProcessedOverlays[lastClosestImageIndex];

      if (!preProcessed.screenCenter) {
        const style = window.getComputedStyle(contentWrapper);
        const matrix = new WebKitCSSMatrix(style.transform);
        const offsetX = matrix.m41;
        const offsetY = matrix.m42;

        const boundingBox = baseImage.getBoundingClientRect();
        const refWidth = preProcessedOverlays[0] ? preProcessedOverlays[0].width : baseImage.naturalWidth;
        const refHeight = preProcessedOverlays[0] ? preProcessedOverlays[0].height : baseImage.naturalHeight;

        const scaleX = boundingBox.width / refWidth;
        const scaleY = boundingBox.height / refHeight;

        const centerX = (preProcessed.centerX * scaleX) + offsetX;
        const centerY = (preProcessed.centerY * scaleY) + offsetY;

        preProcessed.screenCenter = { centerX, centerY };
      }

      const centerX = preProcessed.screenCenter.centerX;
      const centerY = preProcessed.screenCenter.centerY;

      confettiExplosion(centerX, centerY);

      setTimeout(() => {
        window.parent.postMessage(overlay.urlLink, "*");
        console.log('Url enviada:' + overlay.urlLink);
      }, 500);
    });
  }

  function init(container) {
    ensureGlobalArrowLayer();

    imageContainer = container;
    imageContainer.style.cursor = CURSOR_NORMAL;

    contentWrapper = document.createElement('div');
    contentWrapper.id = 'contentWrapper';
    contentWrapper.style.position = 'absolute';
    contentWrapper.style.top = '0';
    contentWrapper.style.left = '0';
    contentWrapper.style.width = '100%';
    contentWrapper.style.height = '100%';
    imageContainer.appendChild(contentWrapper);

    preProcessedOverlays = [];

    baseImage = createAndAppendImage(baseUrl + baseImageFilename, 1, true);
    overlayElements = overlayImages.map((overlay, index) =>
      createAndAppendImage(baseUrl + overlay.arquivo, index + 2, false)
    );

    loadedImages = 0;
    totalImages = overlayElements.length + 1;

    baseImage.onload = () => {
      globalBaseCenter = preProcessOverlays(baseImage);
      centerMenu(globalBaseCenter);
      loadedImages++;
      checkAllLoaded();
    };

    baseImage.onerror = () => {
      console.error("Failed to load base image", baseImage.src);
    };

    window.addEventListener('resize', () => {
      if (globalBaseCenter) centerMenu(globalBaseCenter);
    });

    overlayElements.forEach((img, index) => {
      img.onload = () => {
        preProcessedOverlays[index] = preProcessOverlays(img, index);
        loadedImages++;
        checkAllLoaded();
      };
      img.onerror = () => {
        console.error("Failed to load overlay image", img.src);
      };
    });
  }

  return { init };
}
