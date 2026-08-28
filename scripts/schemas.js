import { z } from 'zod';

const hitAnchorSchema = z.object({
  x: z.number(),
  y: z.number(),
  count: z.number(),
}).strict();

export const centerDataSchema = z.object({
  centerX: z.number(),
  centerY: z.number(),
  bboxCenterX: z.number(),
  bboxCenterY: z.number(),
  width: z.number(),
  height: z.number(),
  contentWidth: z.number(),
  contentHeight: z.number(),
  instructionMask: z.object({
    width: z.number(),
    height: z.number(),
    runs: z.string(),
  }).strict().optional(),
  hitCenterX: z.number().optional(),
  hitCenterY: z.number().optional(),
  hitBboxCenterX: z.number().optional(),
  hitBboxCenterY: z.number().optional(),
  hitContentWidth: z.number().optional(),
  hitContentHeight: z.number().optional(),
  hitAnchors: z.array(hitAnchorSchema).optional(),
}).strict();

export const overlayImageSchema = z.object({
  nomeImagem: z.string().optional(),
  buttonLabel: z.string().optional(),
  arquivo: z.string(),
  urlLink: z.string(),
  description: z.string().optional(),
  arrowStartOffset: z.number().optional(),
  arrowEndOffset: z.number().optional(),
  labelSide: z.enum(['left', 'right', 'top', 'bottom', 'top-left', 'top-right', 'bottom-left', 'bottom-right']).optional(),
  comingSoon: z.union([
    z.string(),
    z.object({
      title: z.string().optional(),
      text: z.string().optional(),
      hint: z.string().optional(),
    }).strict(),
  ]).optional(),
}).strict();

export const sceneConfigSchema = z.object({
  baseUrl: z.string().default(''),
  baseImageFilename: z.string().optional(),
  margin: z.number().default(60),
  horizontalMargin: z.number().optional(),
  fitToContainer: z.boolean().optional(),
  baseScaleToFrame: z.boolean().optional(),
  CURSOR_NORMAL: z.string().optional(),
  CURSOR_HOVER: z.string().optional(),
  ACTIVE_RADIUS: z.number().default(500),
  labelMode: z.enum(['none', 'name', 'descriptionOrName', 'nameOrDescription', 'description']).default('description'),
  labelStyle: z.enum(['tooltip', 'side', 'horizontal']).default('tooltip'),
  arrowStartOffset: z.number().default(300),
  arrowEndOffset: z.number().default(20),
  labelFontSize: z.string().nullable().optional(),
  labelMaxWidth: z.string().nullable().optional(),
  labelMaxDistanceFromSource: z.number().nullable().optional(),
  instructionText: z.string().nullable().optional(),
  instructionTextAvoidDrawing: z.object({
    enabled: z.boolean().default(false),
    viewportPadding: z.number().optional(),
    searchStep: z.number().optional(),
    maxSearchRadius: z.number().optional(),
    minWidthRatio: z.number().optional(),
    minWidthPx: z.number().optional(),
    textAlphaThreshold: z.number().optional(),
    textSampleStride: z.number().optional(),
    safeDistance: z.number().optional(),
    desiredGap: z.number().optional(),
    desiredGapWeight: z.number().optional(),
    offsetDistanceWeight: z.number().optional(),
    widthPreferenceWeight: z.number().optional(),
    preferredImagePoint: z.object({
      x: z.number(),
      y: z.number(),
      horizontal: z.enum(['left', 'center', 'right']).optional(),
      vertical: z.enum(['top', 'center', 'bottom']).optional(),
    }).strict().optional(),
  }).strict().optional(),
  showArrow: z.boolean().default(false),
  alwaysShowOverlays: z.boolean().default(false),
  spiralSearch: z.object({
    enabled: z.boolean().default(false),
    preferredQuadrants: z.array(z.string()).optional(),
    minDistance: z.number().default(60),
    maxDistance: z.number().default(500),
    angleStep: z.number().default(20),
    radiusStep: z.number().default(14),
    padding: z.number().default(14),
  }).strict().optional(),
  precomputedCentersByUrl: z.record(z.string(), centerDataSchema).default({}),
  overlayImages: z.array(overlayImageSchema).default([]),
}).strict();

export const desktopItemSchema = z.object({
  id: z.string(),
  label: z.string(),
  baseImage: z.string(),
  activeImage: z.string(),
  urlLink: z.string(),
  iconScale: z.number().optional(),
  labelScale: z.number().optional(),
}).strict();

export const desktopConfigSchema = z.object({
  CURSOR_NORMAL: z.string().optional(),
  CURSOR_HOVER: z.string().optional(),
  labelStyle: z.string().default('classic'),
  desktopItems: z.array(desktopItemSchema).default([]),
}).strict();

export const anyConfigSchema = z.union([sceneConfigSchema, desktopConfigSchema]);
