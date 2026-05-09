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
    labelMaxDistanceFromSource = null,
    instructionText = null,
    showArrow = false,
    debug = false,
    spiralSearch = {
      enabled: false,
      preferredQuadrants: ['right', 'top', 'bottom', 'left'],
      minDistance: 60,
      maxDistance: 500,
      angleStep: 20,
      radiusStep: 14,
      padding: 14,
    },
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
    if (arrowLayer) {return arrowLayer;}

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
    if (!value) {return '';}
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
    if (!key) {return null;}

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

  function getHitCenterX(preProcessed) {
    return preProcessed.hitCenterX ?? preProcessed.centerX;
  }

  function getHitCenterY(preProcessed) {
    return preProcessed.hitCenterY ?? preProcessed.centerY;
  }

  function getHitBboxCenterX(preProcessed) {
    return preProcessed.hitBboxCenterX ?? preProcessed.bboxCenterX;
  }

  function getHitBboxCenterY(preProcessed) {
    return preProcessed.hitBboxCenterY ?? preProcessed.bboxCenterY;
  }

  function getHitContentWidth(preProcessed) {
    return preProcessed.hitContentWidth ?? preProcessed.contentWidth;
  }

  function getHitContentHeight(preProcessed) {
    return preProcessed.hitContentHeight ?? preProcessed.contentHeight;
  }

  function getHitAnchors(preProcessed) {
    if (Array.isArray(preProcessed.hitAnchors) && preProcessed.hitAnchors.length > 0) {
      return preProcessed.hitAnchors;
    }

    return [{ x: getHitCenterX(preProcessed), y: getHitCenterY(preProcessed), count: 1 }];
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
      const anchors = getHitAnchors(preProcessed);
      let distance = Infinity;

      for (const anchor of anchors) {
        const dx = scaledX - anchor.x;
        const dy = scaledY - anchor.y;
        const anchorDistance = Math.hypot(dx, dy);
        if (anchorDistance < distance) {
          distance = anchorDistance;
        }
      }

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

    if (labelFontSize) {nameContainer.style.fontSize = labelFontSize;}
    if (labelMaxWidth) {nameContainer.style.maxWidth = labelMaxWidth;}

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

    const bboxWidth = getHitContentWidth(preProcessed) - 1;
    const bboxHeight = getHitContentHeight(preProcessed) - 1;
    const bboxLeft = getHitBboxCenterX(preProcessed) - bboxWidth / 2;
    const bboxTop = getHitBboxCenterY(preProcessed) - bboxHeight / 2;

    const screenLeft = (bboxLeft * scaleX) + offsetX;
    const screenTop = (bboxTop * scaleY) + offsetY;
    const screenRight = ((bboxLeft + bboxWidth) * scaleX) + offsetX;
    const screenBottom = ((bboxTop + bboxHeight) * scaleY) + offsetY;

    const screenCenterX = (getHitCenterX(preProcessed) * scaleX) + offsetX;
    const screenCenterY = (getHitCenterY(preProcessed) * scaleY) + offsetY;

    return { x: screenCenterX, y: screenCenterY, leftX: screenLeft, rightX: screenRight, topY: screenTop, bottomY: screenBottom };
  }

  function rectsOverlap(a, b) {
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function lineIntersectsLine(a, b, c, d) {
    const denominator = ((d.y - c.y) * (b.x - a.x)) - ((d.x - c.x) * (b.y - a.y));
    if (denominator === 0) {return false;}

    const ua = (((d.x - c.x) * (a.y - c.y)) - ((d.y - c.y) * (a.x - c.x))) / denominator;
    const ub = (((b.x - a.x) * (a.y - c.y)) - ((b.y - a.y) * (a.x - c.x))) / denominator;

    return ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1;
  }

  function segmentIntersectsRect(p1, p2, rect) {
    if (!rect) {return false;}

    const insideP1 = p1.x >= rect.left && p1.x <= rect.right && p1.y >= rect.top && p1.y <= rect.bottom;
    const insideP2 = p2.x >= rect.left && p2.x <= rect.right && p2.y >= rect.top && p2.y <= rect.bottom;
    if (insideP1 || insideP2) {return true;}

    const edges = [
      [{ x: rect.left, y: rect.top }, { x: rect.right, y: rect.top }],
      [{ x: rect.right, y: rect.top }, { x: rect.right, y: rect.bottom }],
      [{ x: rect.right, y: rect.bottom }, { x: rect.left, y: rect.bottom }],
      [{ x: rect.left, y: rect.bottom }, { x: rect.left, y: rect.top }],
    ];

    return edges.some(([e1, e2]) => lineIntersectsLine(p1, p2, e1, e2));
  }

  function getInstructionRect() {
    const instructionEl = document.getElementById('instructionText');
    if (!instructionEl) {return null;}

    const style = window.getComputedStyle(instructionEl);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {return null;}

    const rect = instructionEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {return null;}
    return rect;
  }

  function getOverlayBoundingRectByIndex(index) {
    if (index < 0 || !preProcessedOverlays[index]) {return null;}
    const c = getScreenCoordinates(preProcessedOverlays[index]);
    return { left: c.leftX, right: c.rightX, top: c.topY, bottom: c.bottomY };
  }

  function getForbiddenRectsForLabel(excludeOverlayIndex = -1) {
    const forbidden = [];
    const instructionRect = getInstructionRect();
    if (instructionRect) {forbidden.push(instructionRect);}

    for (let i = 0; i < preProcessedOverlays.length; i++) {
      if (i === excludeOverlayIndex) {continue;}
      const rect = getOverlayBoundingRectByIndex(i);
      if (!rect) {continue;}
      forbidden.push(rect);
    }

    return forbidden;
  }

  function collidesWithForbidden(rect, forbiddenRects) {
    return forbiddenRects.some((forbidden) => rectsOverlap(rect, forbidden));
  }

  function getQuadrantForPoint(sourceX, sourceY, pointX, pointY) {
    const dx = pointX - sourceX;
    const dy = pointY - sourceY;

    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) {return 'center';}
    if (dx > 0 && dy < 0) {return 'top-right';}
    if (dx > 0 && dy > 0) {return 'bottom-right';}
    if (dx < 0 && dy < 0) {return 'top-left';}
    if (dx < 0 && dy > 0) {return 'bottom-left';}
    if (dx > 0) {return 'right';}
    if (dx < 0) {return 'left';}
    if (dy < 0) {return 'top';}
    return 'bottom';
  }

  function getQuadrantPriority(quadrant, labelSide) {
    if (!labelSide) {return 0;}

    // Direct match
    if (quadrant === labelSide) {return 0;}

    // Partial match for cardinal directions
    if (labelSide === 'right' && (quadrant === 'top-right' || quadrant === 'bottom-right')) {return 1;}
    if (labelSide === 'left' && (quadrant === 'top-left' || quadrant === 'bottom-left')) {return 1;}
    if (labelSide === 'top' && (quadrant === 'top-left' || quadrant === 'top-right')) {return 1;}
    if (labelSide === 'bottom' && (quadrant === 'bottom-left' || quadrant === 'bottom-right')) {return 1;}

    // Partial match for diagonal directions
    if (labelSide === 'top-right' && (quadrant === 'top' || quadrant === 'right')) {return 1;}
    if (labelSide === 'top-left' && (quadrant === 'top' || quadrant === 'left')) {return 1;}
    if (labelSide === 'bottom-right' && (quadrant === 'bottom' || quadrant === 'right')) {return 1;}
    if (labelSide === 'bottom-left' && (quadrant === 'bottom' || quadrant === 'left')) {return 1;}

    // Opposite
    return 2;
  }

  let debugCandidates = [];
  let debugSourcePoint = null;
  let debugLabelSide = null;
  let debugOverlayRects = [];

  function spiralSearchPosition(sourceX, sourceY, labelWidth, labelHeight, forbiddenRects, viewportWidth, viewportHeight, labelSide = null) {
    const preferredSide = labelSide || (spiralSearch.preferredQuadrants ? spiralSearch.preferredQuadrants[0] : null);
    const {
      minDistance: configMinDist,
      maxDistance: configMaxDist,
      angleStep,
      radiusStep,
      padding,
    } = spiralSearch;

    const effectiveMinDist = Math.min(configMinDist, Math.max(viewportWidth, viewportHeight) * 0.3);
    const effectiveMaxDist = Math.min(configMaxDist, Math.max(viewportWidth, viewportHeight) * 0.8);

    const pad = padding;
    let bestCandidate = null;
    let bestScore = Infinity;

    debugCandidates = [];
    debugSourcePoint = { x: sourceX, y: sourceY };
    debugLabelSide = labelSide;

    for (let radius = effectiveMinDist; radius <= effectiveMaxDist; radius += radiusStep) {
      const circumference = 2 * Math.PI * radius;
      const numSamples = Math.max(8, Math.ceil(circumference / (radiusStep * 1.5)));
      const angleIncrement = 360 / numSamples;

      for (let angle = 0; angle < 360; angle += Math.min(angleStep, angleIncrement)) {
        const rad = (angle * Math.PI) / 180;
        const candidateCenterX = sourceX + (radius * Math.cos(rad));
        const candidateCenterY = sourceY + (radius * Math.sin(rad));

        const left = candidateCenterX - (labelWidth / 2);
        const top = candidateCenterY - (labelHeight / 2);

        if (left < pad || top < pad) {continue;}
        if (left + labelWidth > viewportWidth - pad) {continue;}
        if (top + labelHeight > viewportHeight - pad) {continue;}

        const rect = {
          left: left,
          top: top,
          right: left + labelWidth,
          bottom: top + labelHeight,
        };

        if (collidesWithForbidden(rect, forbiddenRects)) {continue;}

        const quadrant = getQuadrantForPoint(sourceX, sourceY, candidateCenterX, candidateCenterY);
        const quadrantPriority = getQuadrantPriority(quadrant, preferredSide);

        const idealDistance = (effectiveMinDist + effectiveMaxDist) / 2;
        const distanceRange = (effectiveMaxDist - effectiveMinDist) / 2;
        const distanceFromIdeal = Math.abs(radius - idealDistance);
        const normalizedDistance = distanceRange > 0 ? (distanceFromIdeal / distanceRange) : 0;

        const score = (quadrantPriority * 1000) + (normalizedDistance * 100);

        debugCandidates.push({
          x: candidateCenterX,
          y: candidateCenterY,
          left: left,
          top: top,
          width: labelWidth,
          height: labelHeight,
          score: score,
          quadrant: quadrant,
          radius: radius,
          isBest: false,
        });

        if (score < bestScore) {
          bestScore = score;
          bestCandidate = {
            left: left,
            top: top,
            score: score,
            quadrant: quadrant,
            distance: radius,
          };
        }
      }

      if (bestCandidate && bestCandidate.distance <= radius) {
        const bestEntry = debugCandidates.find(c => c.left === bestCandidate.left && c.top === bestCandidate.top);
        if (bestEntry) {bestEntry.isBest = true;}
        return { left: bestCandidate.left, top: bestCandidate.top };
      }
    }

    if (bestCandidate) {
      const bestEntry = debugCandidates.find(c => c.left === bestCandidate.left && c.top === bestCandidate.top);
      if (bestEntry) {bestEntry.isBest = true;}
      return { left: bestCandidate.left, top: bestCandidate.top };
    }

    const fallbackLeft = clamp(sourceX - (labelWidth / 2), pad, viewportWidth - labelWidth - pad);
    const fallbackTop = clamp(sourceY - (labelHeight / 2), pad, viewportHeight - labelHeight - pad);
    return { left: fallbackLeft, top: fallbackTop };
  }

  function renderDebugCandidates() {
    if (!debug) {
      const existing = document.getElementById('debugCandidatesContainer');
      if (existing) {existing.remove();}
      return;
    }

    let container = document.getElementById('debugCandidatesContainer');
    if (!container) {
      container = document.createElement('div');
      container.id = 'debugCandidatesContainer';
      container.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
      document.body.appendChild(container);
    }
    container.innerHTML = '';

    const style = window.getComputedStyle(contentWrapper);
    const matrix = new WebKitCSSMatrix(style.transform);
    const offsetX = matrix.m41;
    const offsetY = matrix.m42;
    const boundingBox = baseImage.getBoundingClientRect();
    const refWidth = preProcessedOverlays[0] ? preProcessedOverlays[0].width : baseImage.naturalWidth;
    const refHeight = preProcessedOverlays[0] ? preProcessedOverlays[0].height : baseImage.naturalHeight;
    const scaleX = boundingBox.width / refWidth;
    const scaleY = boundingBox.height / refHeight;

    debugOverlayRects = [];
    preProcessedOverlays.forEach((preProcessed, index) => {
      if (!preProcessed) {return;}
      const coords = getScreenCoordinates(preProcessed);
      debugOverlayRects.push({
        index,
        name: overlayImages[index]?.nomeImagem || `#${index}`,
        left: coords.leftX,
        top: coords.topY,
        width: coords.rightX - coords.leftX,
        height: coords.bottomY - coords.topY,
        centerX: coords.x,
        centerY: coords.y,
        labelSide: overlayImages[index]?.labelSide,
      });
    });

    debugOverlayRects.forEach((r) => {
      const rect = document.createElement('div');
      rect.style.cssText = `position:absolute;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;border:1px dashed rgba(0,255,0,0.6);pointer-events:none;`;
      container.appendChild(rect);

      const centerDot = document.createElement('div');
      centerDot.style.cssText = `position:absolute;left:${r.centerX - 4}px;top:${r.centerY - 4}px;width:8px;height:8px;background:rgba(0,255,0,0.8);border-radius:50%;`;
      container.appendChild(centerDot);

      const anchors = getHitAnchors(preProcessedOverlays[r.index]);
      anchors.forEach((anchor) => {
        const anchorDot = document.createElement('div');
        const anchorX = (anchor.x * scaleX) + offsetX;
        const anchorY = (anchor.y * scaleY) + offsetY;
        anchorDot.style.cssText = `position:absolute;left:${anchorX - 2}px;top:${anchorY - 2}px;width:4px;height:4px;background:rgba(0,180,255,0.9);border-radius:50%;`;
        container.appendChild(anchorDot);
      });

      const nameLabel = document.createElement('div');
      nameLabel.style.cssText = `position:absolute;left:${r.left}px;top:${r.top - 12}px;color:rgba(0,255,0,0.9);font:bold 9px monospace;text-shadow:1px 1px 2px #000;white-space:nowrap;`;
      nameLabel.textContent = `${r.name} [${r.labelSide || 'no-side'}]`;
      container.appendChild(nameLabel);
    });

    if (!debugSourcePoint || debugCandidates.length === 0) {return;}

    const sourceDot = document.createElement('div');
    sourceDot.style.cssText = `position:absolute;left:${debugSourcePoint.x - 6}px;top:${debugSourcePoint.y - 6}px;width:12px;height:12px;background:#ff0000;border-radius:50%;border:2px solid #fff;`;
    sourceDot.title = `Source (${debugSourcePoint.x.toFixed(0)}, ${debugSourcePoint.y.toFixed(0)}) labelSide: ${debugLabelSide || 'none'}`;
    container.appendChild(sourceDot);

    const label = document.createElement('div');
    label.style.cssText = `position:absolute;left:${debugSourcePoint.x + 10}px;top:${debugSourcePoint.y - 8}px;color:#ff0000;font:bold 11px monospace;text-shadow:1px 1px 2px #000;white-space:nowrap;`;
    label.textContent = `SRC ${debugLabelSide || ''}`;
    container.appendChild(label);

    const minScore = Math.min(...debugCandidates.map(c => c.score));
    const maxScore = Math.max(...debugCandidates.map(c => c.score));
    const scoreRange = maxScore - minScore || 1;

    debugCandidates.forEach((c) => {
      const normalized = (c.score - minScore) / scoreRange;

      let color;
      if (c.isBest) {
        color = '#00ff00';
      } else if (c.quadrant === debugLabelSide) {
        color = `hsl(200, 80%, ${50 + normalized * 30}%)`;
      } else {
        const hue = normalized < 0.5 ? 0 : 40;
        color = `hsl(${hue}, 70%, ${40 + normalized * 40}%)`;
      }

      const dot = document.createElement('div');
      dot.style.cssText = `position:absolute;left:${c.x - 3}px;top:${c.y - 3}px;width:6px;height:6px;background:${color};border-radius:50%;opacity:${c.isBest ? 1 : 0.5};`;
      dot.title = `score:${c.score.toFixed(0)} q:${c.quadrant} r:${c.radius.toFixed(0)}${c.isBest ? ' ★ BEST' : ''}`;
      container.appendChild(dot);

      if (c.isBest) {
        const rect = document.createElement('div');
        rect.style.cssText = `position:absolute;left:${c.left}px;top:${c.top}px;width:${c.width}px;height:${c.height}px;border:2px solid #00ff00;background:rgba(0,255,0,0.1);pointer-events:none;`;
        container.appendChild(rect);

        const info = document.createElement('div');
        info.style.cssText = `position:absolute;left:${c.left}px;top:${c.top - 16}px;color:#00ff00;font:bold 10px monospace;text-shadow:1px 1px 2px #000;white-space:nowrap;`;
        info.textContent = `★ ${c.quadrant} score:${c.score.toFixed(0)} dist:${c.radius.toFixed(0)}`;
        container.appendChild(info);
      }
    });
  }

  function chooseLabelPosition(candidates, width, height, forbiddenRects, viewportWidth, viewportHeight, sourceX, sourceY, labelSide = null) {
    if (spiralSearch.enabled) {
      return spiralSearchPosition(sourceX, sourceY, width, height, forbiddenRects, viewportWidth, viewportHeight, labelSide);
    }

    for (const candidate of candidates) {
      const left = clamp(candidate.left, 8, Math.max(8, viewportWidth - width - 8));
      const top = clamp(candidate.top, 8, Math.max(8, viewportHeight - height - 8));
      const rect = { left, top, right: left + width, bottom: top + height };

      if (!collidesWithForbidden(rect, forbiddenRects)) {
        return { left, top };
      }
    }

    const first = candidates[0] || { left: 8, top: 8 };
    const oppositeLeft = first.left < viewportWidth / 2
      ? (viewportWidth - 8 - width)
      : 8;
    const fallbackCandidates = [
      { left: oppositeLeft, top: first.top },
      { left: oppositeLeft, top: first.top - 100 },
      { left: oppositeLeft, top: first.top + 100 },
      { left: oppositeLeft, top: first.top - 180 },
      { left: oppositeLeft, top: first.top + 180 },
    ];

    for (const candidate of fallbackCandidates) {
      const left = clamp(candidate.left, 8, Math.max(8, viewportWidth - width - 8));
      const top = clamp(candidate.top, 8, Math.max(8, viewportHeight - height - 8));
      const rect = { left, top, right: left + width, bottom: top + height };
      if (!collidesWithForbidden(rect, forbiddenRects)) {
        return { left, top };
      }
    }

    return {
      left: clamp(first.left, 8, Math.max(8, viewportWidth - width - 8)),
      top: clamp(first.top, 8, Math.max(8, viewportHeight - height - 8)),
    };
  }

  function chooseLabelPositionWithRules(candidates, width, height, forbiddenRects, viewportWidth, viewportHeight, sourceX, sourceY, labelSide = null) {
    if (spiralSearch.enabled) {
      const spiralResult = spiralSearchPosition(
        sourceX, sourceY, width, height, forbiddenRects, viewportWidth, viewportHeight, labelSide
      );
      if (labelSide) {
        return spiralResult;
      }
      return enforceLabelMaxDistance(
        spiralResult, width, height, sourceX, sourceY, viewportWidth, viewportHeight
      );
    }

    for (const candidate of candidates) {
      const clamped = {
        left: clamp(candidate.left, 8, Math.max(8, viewportWidth - width - 8)),
        top: clamp(candidate.top, 8, Math.max(8, viewportHeight - height - 8)),
      };

      const limited = enforceLabelMaxDistance(
        clamped,
        width,
        height,
        sourceX,
        sourceY,
        viewportWidth,
        viewportHeight
      );

      const rect = {
        left: limited.left,
        top: limited.top,
        right: limited.left + width,
        bottom: limited.top + height,
      };

      if (!collidesWithForbidden(rect, forbiddenRects)) {
        return limited;
      }
    }

    const fallback = chooseLabelPosition(candidates, width, height, forbiddenRects, viewportWidth, viewportHeight, sourceX, sourceY, labelSide);
    return enforceLabelMaxDistance(fallback, width, height, sourceX, sourceY, viewportWidth, viewportHeight);
  }

  function enforceLabelMaxDistance(chosen, width, height, sourceX, sourceY, viewportWidth, viewportHeight) {
    if (!Number.isFinite(labelMaxDistanceFromSource) || labelMaxDistanceFromSource <= 0) {
      return chosen;
    }

    const centerX = chosen.left + (width / 2);
    const centerY = chosen.top + (height / 2);
    const dx = centerX - sourceX;
    const dy = centerY - sourceY;
    const distance = Math.hypot(dx, dy);

    if (distance <= labelMaxDistanceFromSource || distance === 0) {
      return chosen;
    }

    const ratio = labelMaxDistanceFromSource / distance;
    const limitedCenterX = sourceX + (dx * ratio);
    const limitedCenterY = sourceY + (dy * ratio);

    return {
      left: clamp(limitedCenterX - (width / 2), 8, Math.max(8, viewportWidth - width - 8)),
      top: clamp(limitedCenterY - (height / 2), 8, Math.max(8, viewportHeight - height - 8)),
    };
  }

  function getSideVector(side) {
    if (side === 'left') {return { x: -1, y: 0 };}
    if (side === 'right') {return { x: 1, y: 0 };}
    if (side === 'top') {return { x: 0, y: -1 };}
    return { x: 0, y: 1 };
  }

  function buildArrowPathAvoidingInstruction(startX, startY, endX, endY, startSide = 'right', endSide = 'left') {
    const instructionRect = getInstructionRect();
    const start = { x: startX, y: startY };
    const end = { x: endX, y: endY };
    const distance = Math.hypot(endX - startX, endY - startY);
    const handle = clamp(distance * 0.35, 40, 220);
    const startVec = getSideVector(startSide);
    const endVec = getSideVector(endSide);

    const cp1X = startX + (startVec.x * handle);
    const cp1Y = startY + (startVec.y * handle);
    const cp2X = endX + (endVec.x * handle);
    const cp2Y = endY + (endVec.y * handle);

    if (!instructionRect || !segmentIntersectsRect(start, end, instructionRect)) {
      return `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${cp2X} ${cp2Y}, ${endX} ${endY}`;
    }

    const viewportHeight = window.innerHeight;
    const routePadding = 30;
    const routeAbove = Math.max(8, instructionRect.top - routePadding);
    const routeBelow = Math.min(viewportHeight - 8, instructionRect.bottom + routePadding);
    const routeY = (Math.abs(startY - routeAbove) + Math.abs(endY - routeAbove))
      <= (Math.abs(startY - routeBelow) + Math.abs(endY - routeBelow))
      ? routeAbove
      : routeBelow;

    const midX = (startX + endX) / 2;
    const midY = routeY;

    const approach = clamp(distance * 0.22, 24, 120);
    const waypoint1X = midX - approach;
    const waypoint1Y = midY;
    const waypoint2X = midX + approach;
    const waypoint2Y = midY;

    // Use "S" to force tangent continuity at the mid joint (smoother junction).
    return `M ${startX} ${startY} C ${cp1X} ${cp1Y}, ${waypoint1X} ${waypoint1Y}, ${midX} ${midY} S ${waypoint2X} ${waypoint2Y}, ${endX} ${endY}`;
  }

  function getRectAnchorPoint(rect, side) {
    if (side === 'left') {return { x: rect.left, y: rect.top + (rect.height / 2) };}
    if (side === 'right') {return { x: rect.right, y: rect.top + (rect.height / 2) };}
    if (side === 'top') {return { x: rect.left + (rect.width / 2), y: rect.top };}
    return { x: rect.left + (rect.width / 2), y: rect.bottom };
  }

  function offsetPointBySide(point, side, amount, outward = true) {
    const sign = outward ? 1 : -1;
    if (side === 'left') {return { x: point.x - (amount * sign), y: point.y };}
    if (side === 'right') {return { x: point.x + (amount * sign), y: point.y };}
    if (side === 'top') {return { x: point.x, y: point.y - (amount * sign) };}
    return { x: point.x, y: point.y + (amount * sign) };
  }

  function drawArrow(overlayIndex) {
    if (!showArrow) {return;}

    const arrowPath = document.getElementById('dynamicArrow');
    if (!arrowPath) {return;}

    const overlay = overlayImages[overlayIndex];
    const preProcessed = preProcessedOverlays[overlayIndex];

    if (!preProcessed) {return;}

    const coords = getScreenCoordinates(preProcessed);
    const nameContainer = document.getElementById('objectDescription');
    const labelRect = nameContainer.getBoundingClientRect();
    const objectRect = {
      left: coords.leftX,
      right: coords.rightX,
      top: coords.topY,
      bottom: coords.bottomY,
      width: Math.max(1, coords.rightX - coords.leftX),
      height: Math.max(1, coords.bottomY - coords.topY),
    };

    const boundingBox = baseImage.getBoundingClientRect();
    const currentScale = baseImage.naturalWidth ? (boundingBox.width / baseImage.naturalWidth) : 1;

    const baseTextOffset = overlay.arrowEndOffset ?? arrowEndOffset;
    const gapText = baseTextOffset * currentScale;
    const baseMenuOffset = overlay.arrowStartOffset ?? arrowStartOffset;
    const gapMenu = baseMenuOffset * currentScale;

    const objectCenterX = objectRect.left + (objectRect.width / 2);
    const objectCenterY = objectRect.top + (objectRect.height / 2);
    const labelCenterX = labelRect.left + (labelRect.width / 2);
    const labelCenterY = labelRect.top + (labelRect.height / 2);
    const dxCenter = labelCenterX - objectCenterX;
    const dyCenter = labelCenterY - objectCenterY;

    const primaryHorizontal = Math.abs(dxCenter) >= Math.abs(dyCenter);
    const sidePairs = primaryHorizontal
      ? (dxCenter >= 0
        ? [['right', 'left'], ['top', 'bottom'], ['bottom', 'top']]
        : [['left', 'right'], ['top', 'bottom'], ['bottom', 'top']])
      : (dyCenter >= 0
        ? [['bottom', 'top'], ['right', 'left'], ['left', 'right']]
        : [['top', 'bottom'], ['right', 'left'], ['left', 'right']]);

    let best = null;
    for (const [objSide, labelSide] of sidePairs) {
      const objAnchor = getRectAnchorPoint(objectRect, objSide);
      const labelAnchor = getRectAnchorPoint(labelRect, labelSide);
      const start = offsetPointBySide(objAnchor, objSide, gapMenu, true);
      const end = offsetPointBySide(labelAnchor, labelSide, gapText, true);
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const score = (dx * dx) + (dy * dy);

      if (!best || score < best.score) {
        best = { start, end, score, objSide, labelSide };
      }
    }

    if (!best) {return;}

    const pathData = buildArrowPathAvoidingInstruction(
      best.start.x,
      best.start.y,
      best.end.x,
      best.end.y,
      best.objSide,
      best.labelSide
    );
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

    if (labelFontSize) {nameContainer.style.fontSize = labelFontSize;}
    if (labelMaxWidth) {nameContainer.style.maxWidth = labelMaxWidth;}

    if (!labelText || !isActive) {
      nameContainer.style.display = 'none';
      if (arrowPath) {arrowPath.setAttribute('d', '');}
      debugCandidates = [];
      debugSourcePoint = null;
      renderDebugCandidates();
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
      const baseLeft = (targetX - (nameContainer.offsetWidth / 2)) + randomOffsetX;
      const baseTop = onTop ? margin : viewportHeight - nameContainer.offsetHeight - margin;

      const forbiddenRects = getForbiddenRectsForLabel(lastClosestImageIndex);
      const currentOverlay = overlayImages[lastClosestImageIndex] || {};
      const candidates = [
        { left: baseLeft, top: baseTop },
        { left: baseLeft - 140, top: baseTop },
        { left: baseLeft + 140, top: baseTop },
        { left: baseLeft - 260, top: baseTop },
        { left: baseLeft + 260, top: baseTop },
        { left: baseLeft, top: onTop ? (baseTop + 120) : (baseTop - 120) },
      ];
      const chosen = chooseLabelPositionWithRules(
        candidates,
        nameContainer.offsetWidth,
        nameContainer.offsetHeight,
        forbiddenRects,
        viewportWidth,
        viewportHeight,
        targetX,
        targetY,
        currentOverlay.labelSide
      );
      const left = chosen.left;
      const top = chosen.top;

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

        const pathData = buildArrowPathAvoidingInstruction(
          adjustedStartX,
          adjustedStartY,
          textAnchorX,
          textAnchorY,
          onTop ? 'top' : 'bottom',
          onTop ? 'bottom' : 'top'
        );
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
    const baseTop = targetY + randomOffset;
    const minTop = window.innerHeight * 0.1;
    const maxTop = window.innerHeight * 0.8;

    const overlay = overlayImages[lastClosestImageIndex];
    let onRightSide = (seed % 2 === 0);
    if (overlay && overlay.labelSide === 'right') {onRightSide = true;}
    if (overlay && overlay.labelSide === 'left') {onRightSide = false;}

    let desiredTop, desiredLeft;
    if (overlay && overlay.labelSide === 'top') {
      desiredTop = marginSide;
      desiredLeft = targetX - (nameContainer.offsetWidth / 2);
    } else if (overlay && overlay.labelSide === 'bottom') {
      desiredTop = window.innerHeight - nameContainer.offsetHeight - marginSide;
      desiredLeft = targetX - (nameContainer.offsetWidth / 2);
    } else if (overlay && overlay.labelSide === 'right') {
      desiredTop = clamp(baseTop, minTop, maxTop);
      desiredLeft = Math.min(targetX + 200, viewportWidth - marginSide - nameContainer.offsetWidth);
    } else if (overlay && overlay.labelSide === 'left') {
      desiredTop = clamp(baseTop, minTop, maxTop);
      desiredLeft = Math.max(targetX - nameContainer.offsetWidth - 200, marginSide);
    } else {
      desiredTop = clamp(baseTop, minTop, maxTop);
      desiredLeft = onRightSide
        ? (viewportWidth - marginSide - nameContainer.offsetWidth)
        : marginSide;
    }

    const forbiddenRects = getForbiddenRectsForLabel(lastClosestImageIndex);
    const candidates = [
      { left: desiredLeft, top: desiredTop },
      { left: desiredLeft, top: desiredTop - 100 },
      { left: desiredLeft, top: desiredTop + 100 },
      { left: desiredLeft, top: desiredTop - 180 },
      { left: desiredLeft, top: desiredTop + 180 },
    ];

    if (overlay && overlay.labelSide) {
      const closerLeft = overlay.labelSide === 'right'
        ? Math.min(targetX + 150, viewportWidth - marginSide - nameContainer.offsetWidth)
        : Math.max(targetX - nameContainer.offsetWidth - 150, marginSide);
      candidates.push({ left: closerLeft, top: desiredTop });
      candidates.push({ left: closerLeft, top: desiredTop - 120 });
      candidates.push({ left: closerLeft, top: desiredTop + 120 });
      // Opposite-side escape hatch if forced side blocked
      const oppositeLeft = overlay.labelSide === 'right'
        ? Math.max(targetX - nameContainer.offsetWidth - 150, marginSide)
        : Math.min(targetX + 150, viewportWidth - marginSide - nameContainer.offsetWidth);
      candidates.push({ left: oppositeLeft, top: desiredTop });
      candidates.push({ left: oppositeLeft, top: desiredTop - 120 });
      candidates.push({ left: oppositeLeft, top: desiredTop + 120 });
    } else {
      candidates.push({
        left: onRightSide ? marginSide : (viewportWidth - marginSide - nameContainer.offsetWidth),
        top: desiredTop,
      });
      candidates.push({
        left: onRightSide ? marginSide : (viewportWidth - marginSide - nameContainer.offsetWidth),
        top: desiredTop - 120,
      });
      candidates.push({
        left: onRightSide ? marginSide : (viewportWidth - marginSide - nameContainer.offsetWidth),
        top: desiredTop + 120,
      });
    }
    const chosen = chooseLabelPositionWithRules(
      candidates,
      nameContainer.offsetWidth,
      nameContainer.offsetHeight,
      forbiddenRects,
      viewportWidth,
      window.innerHeight,
      targetX,
      targetY,
      overlay ? overlay.labelSide : null
    );

    nameContainer.style.left = chosen.left + 'px';
    nameContainer.style.right = 'auto';
    nameContainer.style.top = chosen.top + 'px';
    if (overlay && (overlay.labelSide === 'top' || overlay.labelSide === 'bottom')) {
      nameContainer.style.textAlign = 'center';
    } else {
      nameContainer.style.textAlign = onRightSide ? 'right' : 'left';
    }

    if (showArrow) {
      drawArrow(lastClosestImageIndex);
    }

    renderDebugCandidates();
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
          if (arrowPath) {arrowPath.setAttribute('d', '');}
        }
      } else {
        changeCursor(isActive);
        if (labelStyle === 'side' || labelStyle === 'horizontal') {
          showNameWithArrow(null, null, e.clientX, e.clientY, 0, 0, false);
        } else {
          showName(null, e.clientX, e.clientY);
          if (arrowPath) {arrowPath.setAttribute('d', '');}
        }
      }
    });

    imageContainer.addEventListener('click', function () {
      if (lastClosestImageIndex < 0 || lastMinDistance > ACTIVE_RADIUS) {return;}

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

        const centerX = (getHitCenterX(preProcessed) * scaleX) + offsetX;
        const centerY = (getHitCenterY(preProcessed) * scaleY) + offsetY;

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

    const instructionEl = document.getElementById('instructionText');
    if (instructionEl) {
      if (instructionText && String(instructionText).trim().length > 0) {
        instructionEl.textContent = instructionText;
        instructionEl.style.display = 'block';
        instructionEl.style.whiteSpace = 'pre-line';
      } else {
        instructionEl.style.display = 'none';
      }
    }

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
      if (globalBaseCenter) {centerMenu(globalBaseCenter);}
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
