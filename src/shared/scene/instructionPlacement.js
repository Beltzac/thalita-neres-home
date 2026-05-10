import { layoutWithLines, prepareWithSegments } from '@chenglou/pretext';

const MANAGED_STYLE_PROPS = ['position', 'left', 'right', 'top', 'bottom', 'width', 'maxWidth', 'transform'];

function parsePx(value, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function buildCanvasFont(style) {
  const fontStyle = style.fontStyle || 'normal';
  const fontWeight = style.fontWeight || '400';
  const fontSize = style.fontSize || '16px';
  const fontFamily = style.fontFamily || 'sans-serif';
  return `${fontStyle} ${fontWeight} ${fontSize} ${fontFamily}`;
}

function getLineHeight(style) {
  const fontSizePx = parsePx(style.fontSize, 16);
  const computedLineHeight = parsePx(style.lineHeight, NaN);
  return Number.isFinite(computedLineHeight) ? computedLineHeight : (fontSizePx * 1.2);
}

function getLetterSpacing(style) {
  const letterSpacing = parsePx(style.letterSpacing, NaN);
  return Number.isFinite(letterSpacing) ? letterSpacing : 0;
}

function computeDistanceField(values, width, height) {
  const inf = 1e9;
  const diag = Math.SQRT2;
  const distances = new Float32Array(values.length);

  for (let i = 0; i < values.length; i++) {
    distances[i] = values[i] === 1 ? 0 : inf;
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width) + x;
      let best = distances[index];

      if (x > 0) {best = Math.min(best, distances[index - 1] + 1);}
      if (y > 0) {best = Math.min(best, distances[index - width] + 1);}
      if (x > 0 && y > 0) {best = Math.min(best, distances[index - width - 1] + diag);}
      if (x < width - 1 && y > 0) {best = Math.min(best, distances[index - width + 1] + diag);}

      distances[index] = best;
    }
  }

  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const index = (y * width) + x;
      let best = distances[index];

      if (x < width - 1) {best = Math.min(best, distances[index + 1] + 1);}
      if (y < height - 1) {best = Math.min(best, distances[index + width] + 1);}
      if (x < width - 1 && y < height - 1) {best = Math.min(best, distances[index + width + 1] + diag);}
      if (x > 0 && y < height - 1) {best = Math.min(best, distances[index + width - 1] + diag);}

      distances[index] = best;
    }
  }

  return distances;
}

function decodeInstructionMask(maskData) {
  if (!maskData || !maskData.runs || !maskData.width || !maskData.height) {return null;}
  if (maskData._decoded) {return maskData._decoded;}

  const runs = String(maskData.runs)
    .split('.')
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 36));

  const values = new Uint8Array(maskData.width * maskData.height);
  let value = 0;
  let index = 0;

  for (const run of runs) {
    const end = Math.min(values.length, index + run);
    if (value === 1) {
      values.fill(1, index, end);
    }
    index = end;
    value = value === 1 ? 0 : 1;
    if (index >= values.length) {break;}
  }

  maskData._decoded = {
    width: maskData.width,
    height: maskData.height,
    values,
    distances: computeDistanceField(values, maskData.width, maskData.height),
  };

  return maskData._decoded;
}

function getCandidateWidths(maxWidth, minWidth) {
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) {return [];}
  const widths = [maxWidth];
  const effectiveMin = Math.min(minWidth, maxWidth);
  const ratios = [0.92, 0.84, 0.76, 0.68];

  ratios.forEach((ratio) => {
    const width = Math.round(maxWidth * ratio);
    if (width >= effectiveMin) {
      widths.push(width);
    }
  });

  widths.push(Math.round(effectiveMin));

  return [...new Set(widths.filter((value) => value > 0))].sort((a, b) => b - a);
}

function generateOffsets(step, maxRadius) {
  const normalizedStep = Math.max(4, Math.round(step));
  const normalizedRadius = Math.max(0, Math.round(maxRadius));
  const maxSteps = Math.floor(normalizedRadius / normalizedStep);
  const offsets = [];

  for (let xStep = -maxSteps; xStep <= maxSteps; xStep++) {
    for (let yStep = -maxSteps; yStep <= maxSteps; yStep++) {
      const dx = xStep * normalizedStep;
      const dy = yStep * normalizedStep;
      const distance = Math.hypot(dx, dy);
      if (distance <= normalizedRadius) {
        offsets.push({ dx, dy, distance });
      }
    }
  }

  offsets.sort((a, b) => a.distance - b.distance);
  return offsets;
}

function getTextBitmap({ lines, width, height, font, lineHeight, textAlign, direction, safeDistance, alphaThreshold, sampleStride }) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));

  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {return null;}

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.font = font;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.direction = direction;
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.lineWidth = Math.max(0, safeDistance * 2);

  lines.forEach((line, index) => {
    const y = index * lineHeight;
    let x = 0;

    if (textAlign === 'right' || (textAlign === 'end' && direction !== 'rtl')) {
      x = width - line.width;
    } else if (textAlign === 'center') {
      x = (width - line.width) / 2;
    } else if (textAlign === 'end' && direction === 'rtl') {
      x = 0;
    } else if (textAlign === 'start' && direction === 'rtl') {
      x = width - line.width;
    }

    if (safeDistance > 0) {
      ctx.strokeText(line.text, x, y);
    }
    ctx.fillText(line.text, x, y);
  });

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  const points = [];
  const stride = Math.max(1, sampleStride);

  for (let y = 0; y < canvas.height; y += stride) {
    for (let x = 0; x < canvas.width; x += stride) {
      const alpha = imageData[((y * canvas.width) + x) * 4 + 3];
      if (alpha >= alphaThreshold) {
        points.push(x, y);
      }
    }
  }

  return {
    width: canvas.width,
    height: canvas.height,
    points,
  };
}

function evaluateCandidate({ textBitmap, left, top, baseRect, baseCenter, mask, stopAfter = 1 }) {
  if (!textBitmap || !mask || !baseRect.width || !baseRect.height) {
    return { overlapCount: Infinity, minDistancePx: Infinity };
  }

  const scaleX = baseCenter.width / baseRect.width;
  const scaleY = baseCenter.height / baseRect.height;
  const maskPixelToScreenPx = Math.min(baseRect.width / mask.width, baseRect.height / mask.height);
  let overlapCount = 0;
  let minDistanceMask = Infinity;

  for (let i = 0; i < textBitmap.points.length; i += 2) {
    const screenX = left + textBitmap.points[i];
    const screenY = top + textBitmap.points[i + 1];

    const imageX = (screenX - baseRect.left) * scaleX;
    const imageY = (screenY - baseRect.top) * scaleY;

    if (imageX < 0 || imageY < 0 || imageX >= baseCenter.width || imageY >= baseCenter.height) {
      continue;
    }

    const maskX = Math.floor((imageX / baseCenter.width) * mask.width);
    const maskY = Math.floor((imageY / baseCenter.height) * mask.height);
    const index = (maskY * mask.width) + maskX;

    if (mask.values[index] === 1) {
      overlapCount++;
      if (overlapCount >= stopAfter) {
        return { overlapCount, minDistancePx: 0 };
      }
      continue;
    }

    minDistanceMask = Math.min(minDistanceMask, mask.distances[index]);
  }

  return {
    overlapCount,
    minDistancePx: Number.isFinite(minDistanceMask) ? (minDistanceMask * maskPixelToScreenPx) : Infinity,
  };
}

function restoreManagedStyles(instructionEl, originalStyles) {
  MANAGED_STYLE_PROPS.forEach((prop) => {
    instructionEl.style[prop] = originalStyles[prop];
  });
}

export function createInstructionTextPlacer({ instructionEl, getBaseImage, getBaseCenter, options = {} }) {
  const originalStyles = Object.fromEntries(MANAGED_STYLE_PROPS.map((prop) => [prop, instructionEl.style[prop] || '']));
  const layoutOptions = {
    enabled: options.enabled !== false,
    viewportPadding: options.viewportPadding ?? 24,
    searchStep: options.searchStep ?? 16,
    maxSearchRadius: options.maxSearchRadius ?? 320,
    minWidthRatio: options.minWidthRatio ?? 0.68,
    minWidthPx: options.minWidthPx ?? 220,
    textAlphaThreshold: options.textAlphaThreshold ?? 20,
    textSampleStride: options.textSampleStride ?? 2,
    safeDistance: options.safeDistance ?? 8,
    desiredGap: options.desiredGap ?? ((options.safeDistance ?? 8) + 6),
    desiredGapWeight: options.desiredGapWeight ?? 3,
    offsetDistanceWeight: options.offsetDistanceWeight ?? 1,
    widthPreferenceWeight: options.widthPreferenceWeight ?? 0.12,
  };

  const textBitmapCache = new Map();
  let prepared = null;
  let preparedKey = '';
  let scheduledRunId = 0;

  async function run(runId) {
    if (!layoutOptions.enabled) {return;}
    if (document.fonts?.ready) {
      await document.fonts.ready;
    }
    if (runId !== scheduledRunId) {return;}

    const baseImageEl = getBaseImage();
    const baseCenter = getBaseCenter();
    const mask = decodeInstructionMask(baseCenter?.instructionMask);

    if (!instructionEl || !baseImageEl || !baseCenter || !mask) {return;}
    if (instructionEl.style.display === 'none') {return;}

    restoreManagedStyles(instructionEl, originalStyles);

    const computedStyle = window.getComputedStyle(instructionEl);
    const preferredRect = instructionEl.getBoundingClientRect();
    const baseRect = baseImageEl.getBoundingClientRect();

    if (!preferredRect.width || !baseRect.width || !baseRect.height) {return;}

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const viewportPadding = Math.max(8, layoutOptions.viewportPadding);
    const maxWidth = preferredRect.width;
    const minWidth = Math.max(layoutOptions.minWidthPx, preferredRect.width * layoutOptions.minWidthRatio);
    const widths = getCandidateWidths(maxWidth, minWidth);
    const lineHeight = getLineHeight(computedStyle);
    const letterSpacing = getLetterSpacing(computedStyle);
    const text = instructionEl.textContent || '';
    const font = buildCanvasFont(computedStyle);
    const prepareKey = `${text}__${font}__${letterSpacing}`;

    if (!prepared || preparedKey !== prepareKey) {
      prepared = prepareWithSegments(text, font, {
        whiteSpace: 'pre-wrap',
        letterSpacing,
      });
      preparedKey = prepareKey;
      textBitmapCache.clear();
    }

    const measuredPosition = {
      mode: computedStyle.position || 'fixed',
      horizontalAnchor: computedStyle.left === 'auto' && computedStyle.right !== 'auto' ? 'right' : 'left',
      verticalAnchor: computedStyle.top === 'auto' && computedStyle.bottom !== 'auto' ? 'bottom' : 'top',
      left: preferredRect.left,
      top: preferredRect.top,
      rightInset: viewportWidth - preferredRect.right,
      bottomInset: viewportHeight - preferredRect.bottom,
      textAlign: computedStyle.textAlign || 'left',
      direction: computedStyle.direction || 'ltr',
    };

    const scaleToScreenX = baseRect.width / baseCenter.width;
    const scaleToScreenY = baseRect.height / baseCenter.height;

    const offsets = generateOffsets(
      layoutOptions.searchStep,
      Math.max(layoutOptions.searchStep, Math.min(layoutOptions.maxSearchRadius, Math.max(viewportWidth, viewportHeight) * 0.35))
    );

    let bestValid = null;
    let fallback = null;

    for (const width of widths) {
      const widthKey = `${width}`;
      let cached = textBitmapCache.get(widthKey);

      if (!cached) {
        const layoutResult = layoutWithLines(prepared, width, lineHeight);
        const textHeight = Math.max(lineHeight, layoutResult.height || (layoutResult.lineCount * lineHeight));
        const textBitmap = getTextBitmap({
          lines: layoutResult.lines,
          width,
          height: textHeight,
          font,
          lineHeight,
          textAlign: measuredPosition.textAlign,
          direction: measuredPosition.direction,
          safeDistance: layoutOptions.safeDistance,
          alphaThreshold: layoutOptions.textAlphaThreshold,
          sampleStride: layoutOptions.textSampleStride,
        });

        cached = {
          width,
          height: textHeight,
          textBitmap,
        };
        textBitmapCache.set(widthKey, cached);
      }

      let preferredLeft;
      let preferredTop;

      if (layoutOptions.preferredImagePoint) {
        const point = layoutOptions.preferredImagePoint;
        const anchorScreenX = baseRect.left + (point.x * scaleToScreenX);
        const anchorScreenY = baseRect.top + (point.y * scaleToScreenY);
        const horizontal = point.horizontal || 'left';
        const vertical = point.vertical || 'top';

        preferredLeft = anchorScreenX;
        preferredTop = anchorScreenY;

        if (horizontal === 'center') {preferredLeft -= cached.width / 2;}
        if (horizontal === 'right') {preferredLeft -= cached.width;}
        if (vertical === 'center') {preferredTop -= cached.height / 2;}
        if (vertical === 'bottom') {preferredTop -= cached.height;}
      } else {
        preferredLeft = measuredPosition.horizontalAnchor === 'right'
          ? viewportWidth - measuredPosition.rightInset - cached.width
          : measuredPosition.left;
        preferredTop = measuredPosition.verticalAnchor === 'bottom'
          ? viewportHeight - measuredPosition.bottomInset - cached.height
          : measuredPosition.top;
      }

      const seen = new Set();

      for (const offset of offsets) {
        const left = clamp(preferredLeft + offset.dx, viewportPadding, viewportWidth - cached.width - viewportPadding);
        const top = clamp(preferredTop + offset.dy, viewportPadding, viewportHeight - cached.height - viewportPadding);
        const key = `${Math.round(left)}:${Math.round(top)}:${cached.width}:${Math.round(cached.height)}`;

        if (seen.has(key)) {continue;}
        seen.add(key);

        const candidate = evaluateCandidate({
          textBitmap: cached.textBitmap,
          left,
          top,
          baseRect,
          baseCenter,
          mask,
          stopAfter: 2,
        });

        if (candidate.overlapCount === 0) {
          if (layoutOptions.preferredImagePoint) {
            instructionEl.style.position = measuredPosition.mode;
            instructionEl.style.left = `${Math.round(left)}px`;
            instructionEl.style.top = `${Math.round(top)}px`;
            instructionEl.style.right = 'auto';
            instructionEl.style.bottom = 'auto';
            instructionEl.style.width = `${Math.round(cached.width)}px`;
            instructionEl.style.maxWidth = 'none';
            instructionEl.style.transform = 'none';
            return;
          }

          const gapPenalty = Math.abs(candidate.minDistancePx - layoutOptions.desiredGap) * layoutOptions.desiredGapWeight;
          const offsetPenalty = offset.distance * layoutOptions.offsetDistanceWeight;
          const widthPenalty = (maxWidth - cached.width) * layoutOptions.widthPreferenceWeight;
          const score = gapPenalty + offsetPenalty + widthPenalty;

          if (!bestValid || score < bestValid.score) {
            bestValid = {
              score,
              left,
              top,
              width: cached.width,
              mode: measuredPosition.mode,
            };
          }
        }

        if (!fallback || candidate.overlapCount < fallback.overlap || (candidate.overlapCount === fallback.overlap && offset.distance < fallback.distance)) {
          fallback = {
            overlap: candidate.overlapCount,
            distance: offset.distance,
            left,
            top,
            width: cached.width,
            mode: measuredPosition.mode,
          };
        }
      }
    }

    const chosen = bestValid || fallback;

    if (chosen) {
      instructionEl.style.position = chosen.mode;
      instructionEl.style.left = `${Math.round(chosen.left)}px`;
      instructionEl.style.top = `${Math.round(chosen.top)}px`;
      instructionEl.style.right = 'auto';
      instructionEl.style.bottom = 'auto';
      instructionEl.style.width = `${Math.round(chosen.width)}px`;
      instructionEl.style.maxWidth = 'none';
      instructionEl.style.transform = 'none';
    } else {
      restoreManagedStyles(instructionEl, originalStyles);
    }
  }

  function schedule() {
    const runId = ++scheduledRunId;
    window.requestAnimationFrame(() => {
      run(runId).catch((error) => {
        console.error('Instruction text placement failed:', error);
      });
    });
  }

  function reset() {
    restoreManagedStyles(instructionEl, originalStyles);
  }

  return { schedule, reset };
}
