import { sampleQuads } from './color'
import type { Random } from './random'
import { createSurface, surfacePixels, type Surface } from './surface'
import { DEFAULT_EFFECT_PARAMS, MAX_SPAN_WIDTH } from './types'
import { measureWasm, type WasmKernels } from './wasm'
import type {
  ColorSortDirection,
  CurtainAxis,
  CurtainEffect,
  DetailNoiseMode,
  EffectId,
  EffectParams,
  Generation,
  LayerEdge,
  SectionDirection,
} from './types'

export type EffectRenderContext = {
  ctx: CanvasRenderingContext2D
  width: number
  height: number
  source: ImageData
  mask: Float32Array | null
  seed: number
  random: Random
  params: EffectParams
  edge: LayerEdge
  generation: Generation
  wasm: WasmKernels
}

export type EffectControl =
  | { type: 'range'; key: keyof EffectParams; label: string; min: number; max: number; step: number; fallback?: number }
  | { type: 'select'; key: keyof EffectParams; label: string; options: { value: string; label: string }[] }
  | { type: 'toggle'; key: keyof EffectParams; label: string };

export type EffectDefinition = {
  id: EffectId;
  label: string;
  defaults: Partial<EffectParams>;
  controls: EffectControl[];
  render: (context: EffectRenderContext) => void;
};

const MAX_GRID_SQUARES = 200

const EFFECT_IDS: EffectId[] = [
  'pixel-sort',
  'galaxy',
  'voronoi',
  'sections',
  'detail-noise',
  'curtain-grid',
  'grey-squares',
  'rect',
  'circles',
  'lines',
  'vertical-lines',
  'horizontal-lines',
];

const EFFECT_ALIASES: Record<string, EffectId> = {
  'color-sorting': 'pixel-sort',
  'pixel-sort-areas': 'pixel-sort',
};

export function normalizeEffectId(value: unknown, fallback: EffectId = 'grey-squares'): EffectId {
  if (typeof value !== 'string') return fallback;
  const alias = EFFECT_ALIASES[value];
  if (alias) return alias;
  return (EFFECT_IDS as string[]).includes(value) ? (value as EffectId) : fallback;
}

export function defaultParams(effect: EffectId): EffectParams {
  return { ...DEFAULT_EFFECT_PARAMS, ...EFFECTS[effect].defaults };
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function directionOf(value: unknown, fallback: ColorSortDirection): ColorSortDirection {
  return value === 'vertical' || value === 'horizontal' ? value : fallback;
}

export function sanitizeParams(effect: EffectId, value: unknown): EffectParams {
  const base = defaultParams(effect);
  if (typeof value !== 'object' || value === null) return base;
  const record = value as Record<string, unknown>;
  const amount = record.amount;
  return {
    grayLevels: Math.round(clampNumber(record.grayLevels, 2, 16, base.grayLevels)),
    direction: directionOf(record.direction, base.direction),
    reverse: typeof record.reverse === 'boolean' ? record.reverse : base.reverse,
    randomness: clampNumber(record.randomness, 0, 100, base.randomness),
    spanWidth: Math.round(clampNumber(record.spanWidth, 1, MAX_SPAN_WIDTH, base.spanWidth)),
    containedBlocks: typeof record.containedBlocks === 'boolean' ? record.containedBlocks : base.containedBlocks,
    amount: amount === null ? null : amount === undefined ? base.amount : clampNumber(amount, 0, 100, base.amount ?? 100),
    sectionCount: Math.round(clampNumber(record.sectionCount, 1, 20, base.sectionCount)),
    sectionOffset: clampNumber(record.sectionOffset, 0, 100, base.sectionOffset),
    sectionDirection: (record.sectionDirection === 'vertical' || record.sectionDirection === 'horizontal'
      ? record.sectionDirection
      : base.sectionDirection) as SectionDirection,
    sectionInvertRatio: clampNumber(record.sectionInvertRatio, 0, 100, base.sectionInvertRatio),
    sectionPosterizeRatio: clampNumber(record.sectionPosterizeRatio, 0, 100, base.sectionPosterizeRatio),
    detailNoiseMode: (record.detailNoiseMode === 'bw' || record.detailNoiseMode === 'color'
      ? record.detailNoiseMode
      : base.detailNoiseMode) as DetailNoiseMode,
    voronoiPoints: Math.round(clampNumber(record.voronoiPoints, 4, 12000, base.voronoiPoints)),
    gridSize: Math.round(clampNumber(record.gridSize, 2, MAX_GRID_SQUARES, base.gridSize)),
    gridMargin: clampNumber(record.gridMargin, 0, 40, base.gridMargin),
    gridCurtainCount: Math.round(clampNumber(record.gridCurtainCount, 0, 8, base.gridCurtainCount)),
    gridCurtainWidth: clampNumber(record.gridCurtainWidth, 1, 100, base.gridCurtainWidth),
    gridCurtainRandomness: clampNumber(record.gridCurtainRandomness, 0, 100, base.gridCurtainRandomness),
    gridCurtainEdgeJitter: clampNumber(record.gridCurtainEdgeJitter, 0, 100, base.gridCurtainEdgeJitter),
    gridCurtainEffect: (record.gridCurtainEffect === 'rasterize' || record.gridCurtainEffect === 'greyscale'
      ? record.gridCurtainEffect
      : record.gridCurtainEffect === 'inverse'
        ? 'inverse'
        : base.gridCurtainEffect) as CurtainEffect,
    gridCurtainAxis: (record.gridCurtainAxis === 'columns' || record.gridCurtainAxis === 'rows'
      ? record.gridCurtainAxis
      : base.gridCurtainAxis) as CurtainAxis,
  };
}

function rgba(r: number, g: number, b: number, alpha = 255): string {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha / 255})`
}

function drawPixelBuffer(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  pointer: number,
  byteLength: number,
  wasm: WasmKernels,
) {
  const pixels = new Uint8ClampedArray(wasm.memory.buffer, pointer, byteLength).slice()
  ctx.putImageData(new ImageData(pixels, width, height), 0, 0)
}

function putQuad(
  coordinates: Float32Array,
  index: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  order: 'corners' | 'clockwise' = 'corners',
) {
  const offset = index * 8
  coordinates[offset] = x0
  coordinates[offset + 1] = y0
  if (order === 'corners') {
    coordinates[offset + 2] = x1
    coordinates[offset + 3] = y0
    coordinates[offset + 4] = x0
    coordinates[offset + 5] = y1
    coordinates[offset + 6] = x1
    coordinates[offset + 7] = y1
  } else {
    coordinates[offset + 2] = x0
    coordinates[offset + 3] = y1
    coordinates[offset + 4] = x1
    coordinates[offset + 5] = y1
    coordinates[offset + 6] = x1
    coordinates[offset + 7] = y0
  }
}

function batchedRect({ ctx, width, height, source, random, wasm }: EffectRenderContext) {
  const count = 20000
  const coords = new Float32Array(count * 8)
  const shapes = new Float32Array(count * 5)
  for (let i = 0; i < count; i++) {
    const x = random.random(width)
    const y = random.random(height)
    const w = random.random(width / 20) / 2
    const h = random.random(height / 20) / 2
    putQuad(coords, i, x - w, y - h, x + w, y + h)
    shapes.set([x, y, w, h, random.random() * 255], i * 5)
  }
  const colors = sampleQuads(source, coords, wasm)
  ctx.lineWidth = 1
  for (let i = 0; i < count; i++) {
    const shape = i * 5
    const color = i * 3
    ctx.fillStyle = rgba(colors[color], colors[color + 1], colors[color + 2], shapes[shape + 4])
    ctx.strokeStyle = rgba(colors[color], colors[color + 1], colors[color + 2])
    ctx.beginPath()
    ctx.rect(
      shapes[shape] - shapes[shape + 2],
      shapes[shape + 1] - shapes[shape + 3],
      shapes[shape + 2] * 2,
      shapes[shape + 3] * 2,
    )
    ctx.fill()
    ctx.stroke()
  }
}

function rect(context: EffectRenderContext) {
  batchedRect(context)
}

function batchedCircles({ ctx, width, height, source, random, wasm }: EffectRenderContext) {
  const count = 20000
  const coords = new Float32Array(count * 8)
  const shapes = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const x = random.random(width)
    const y = random.random(height)
    const w = random.random(width / 20) / 2
    putQuad(coords, i, x - w, y - w, x + w, y + w)
    shapes.set([x, y, w, random.random() * 255], i * 4)
  }
  const colors = sampleQuads(source, coords, wasm)
  ctx.lineWidth = 1
  for (let i = 0; i < count; i++) {
    const shape = i * 4
    const color = i * 3
    ctx.fillStyle = rgba(colors[color], colors[color + 1], colors[color + 2], shapes[shape + 3])
    ctx.strokeStyle = rgba(colors[color], colors[color + 1], colors[color + 2])
    ctx.beginPath()
    ctx.arc(shapes[shape], shapes[shape + 1], shapes[shape + 2], 0, Math.PI * 2)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
}

function circles(context: EffectRenderContext) {
  batchedCircles(context)
}

function batchedGraySquares({ ctx, width, height, source, params, random, wasm }: EffectRenderContext) {
  const count = 20000
  const coords = new Float32Array(count * 8)
  const shapes = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x = random.random(width)
    const y = random.random(height)
    const halfSize = random.random(Math.min(width, height) / 40) / 2
    putQuad(coords, i, x - halfSize, y - halfSize, x + halfSize, y + halfSize)
    shapes.set([x, y, halfSize], i * 3)
  }
  const colors = sampleQuads(source, coords, wasm)
  const levels = Math.max(2, Math.min(16, Math.round(params.grayLevels)))
  const step = 255 / (levels - 1)
  ctx.lineWidth = 1
  for (let i = 0; i < count; i++) {
    const color = i * 3
    const shape = i * 3
    const luminance = 0.299 * colors[color] + 0.587 * colors[color + 1] + 0.114 * colors[color + 2]
    const squareColor = Math.round(luminance / step) * step
    const borderColor = squareColor > 127.5 ? 0 : 255
    ctx.fillStyle = rgba(squareColor, squareColor, squareColor, 127.5)
    ctx.strokeStyle = rgba(borderColor, borderColor, borderColor, 127.5)
    ctx.beginPath()
    ctx.rect(
      shapes[shape] - shapes[shape + 2],
      shapes[shape + 1] - shapes[shape + 2],
      shapes[shape + 2] * 2,
      shapes[shape + 2] * 2,
    )
    ctx.fill()
    ctx.stroke()
  }
}

function graySquares(context: EffectRenderContext) {
  batchedGraySquares(context)
}

function batchedLines({ ctx, width, height, source, random, wasm }: EffectRenderContext) {
  const count = 90000
  const coords = new Float32Array(count * 8)
  const shapes = new Float32Array(count * 4)
  const sampleIndices = new Int32Array(count).fill(-1)
  let sampleCount = 0
  for (let i = 0; i < count; i++) {
    const x1 = random.random(width)
    const y1 = random.random(height)
    const angle = random.random(Math.PI * 2)
    const length = random.random(Math.min(width, height) / 10)
    const x2 = x1 + Math.cos(angle) * length
    const y2 = y1 + Math.sin(angle) * length
    shapes.set([x1, y1, x2, y2], i * 4)
    if (x1 === x2 || y1 === y2) continue
    putQuad(coords, sampleCount++, x1, y1, x2, y2, 'clockwise')
    sampleIndices[i] = sampleCount - 1
  }
  const samples = sampleCount ? sampleQuads(source, coords.subarray(0, sampleCount * 8), wasm) : new Uint8Array()
  ctx.lineWidth = width / 700
  for (let i = 0; i < count; i++) {
    const colorIndex = sampleIndices[i]
    if (colorIndex < 0) ctx.strokeStyle = rgba(255, 255, 255)
    else ctx.strokeStyle = rgba(samples[colorIndex * 3], samples[colorIndex * 3 + 1], samples[colorIndex * 3 + 2])
    const shape = i * 4
    ctx.beginPath()
    ctx.moveTo(shapes[shape], shapes[shape + 1])
    ctx.lineTo(shapes[shape + 2], shapes[shape + 3])
    ctx.stroke()
  }
}

function lines(context: EffectRenderContext) {
  batchedLines(context)
}

function batchedVerticalLines({ ctx, width, height, source, random, wasm }: EffectRenderContext) {
  const count = 90000
  const strokeWidth = width / 700
  const halfWidth = strokeWidth / 2
  const coords = new Float32Array(count * 8)
  const shapes = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x = random.random(width)
    const y1 = random.random(height)
    const y2 = y1 + random.random(Math.min(width, height) / 10)
    putQuad(coords, i, x - halfWidth, y1, x + halfWidth, y2)
    shapes.set([x, y1, y2], i * 3)
  }
  const colors = sampleQuads(source, coords, wasm)
  ctx.lineWidth = strokeWidth
  for (let i = 0; i < count; i++) {
    const color = i * 3
    const shape = i * 3
    ctx.strokeStyle = rgba(colors[color], colors[color + 1], colors[color + 2])
    ctx.beginPath()
    ctx.moveTo(shapes[shape], shapes[shape + 1])
    ctx.lineTo(shapes[shape], shapes[shape + 2])
    ctx.stroke()
  }
}

function verticalLines(context: EffectRenderContext) {
  batchedVerticalLines(context)
}

function batchedHorizontalLines({ ctx, width, height, source, random, wasm }: EffectRenderContext) {
  const count = 90000
  const strokeWidth = width / 700
  const halfWidth = strokeWidth / 2
  const coords = new Float32Array(count * 8)
  const shapes = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const x1 = random.random(width)
    const y = random.random(height)
    const x2 = x1 + random.random(Math.min(width, height) / 10)
    putQuad(coords, i, x1, y - halfWidth, x2, y + halfWidth)
    shapes.set([x1, y, x2], i * 3)
  }
  const colors = sampleQuads(source, coords, wasm)
  ctx.lineWidth = strokeWidth
  for (let i = 0; i < count; i++) {
    const color = i * 3
    const shape = i * 3
    ctx.strokeStyle = rgba(colors[color], colors[color + 1], colors[color + 2])
    ctx.beginPath()
    ctx.moveTo(shapes[shape], shapes[shape + 1])
    ctx.lineTo(shapes[shape + 2], shapes[shape + 1])
    ctx.stroke()
  }
}

function horizontalLines(context: EffectRenderContext) {
  batchedHorizontalLines(context)
}

function pixelSort({ ctx, width, height, source, mask, seed, params, edge, wasm }: EffectRenderContext) {
  const byteLength = width * height * 4;
  wasm.pfree();
  const sourcePtr = wasm.palloc(byteLength) >>> 0;
  const targetPtr = wasm.palloc(byteLength) >>> 0;
  const maskPtr = mask ? wasm.palloc(mask.length) >>> 0 : 0;
  const memory = wasm.memory.buffer;
  new Uint8Array(memory, sourcePtr, byteLength).set(source.data);
  if (mask) {
    const weights = new Uint8Array(memory, maskPtr, mask.length);
    for (let i = 0; i < mask.length; i++) weights[i] = mask[i] > 0 ? 1 : 0;
  }
  measureWasm('pixelSort', () => wasm.pixelSort(
    sourcePtr,
    targetPtr,
    maskPtr,
    width,
    height,
    mask ? 1 : 0,
    params.direction === 'horizontal' ? 0 : 1,
    params.reverse ? 1 : 0,
    params.randomness,
    params.spanWidth,
    params.containedBlocks ? 1 : 0,
    edge.mode === 'ragged' ? edge.jitter : 0,
    params.amount === null ? 0 : 1,
    params.amount ?? 100,
    seed >>> 0,
  ));
  drawPixelBuffer(ctx, width, height, targetPtr, byteLength, wasm);
}

function drawStar(ctx: CanvasRenderingContext2D, x: number, y: number, outer: number, inner: number, points: number) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const px = x + Math.cos(angle) * r;
    const py = y + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
}

function batchedGalaxy({ ctx, width, height, source, random, wasm }: EffectRenderContext) {
  const count = 20000
  const coords = new Float32Array(count * 8)
  const stars = new Float32Array(count * 6)
  for (let i = 0; i < count; i++) {
    const x = random.random(width)
    const y = random.random(height)
    const radius = random.random(width / 30)
    putQuad(coords, i, x - radius, y - radius, x + radius, y + radius)
    stars.set([x, y, radius, random.random() * 255, radius * random.random(0.6, 0.7), Math.floor(random.random(7, 12))], i * 6)
  }
  const colors = sampleQuads(source, coords, wasm)
  for (let i = 0; i < count; i++) {
    const star = i * 6
    const color = i * 3
    ctx.fillStyle = rgba(colors[color], colors[color + 1], colors[color + 2], stars[star + 3])
    drawStar(ctx, stars[star], stars[star + 1], stars[star + 2], stars[star + 4], stars[star + 5])
  }
  ctx.fillStyle = rgba(255, 255, 255, 140)
  for (let i = 0; i < 300; i++) {
    const x = random.random(width)
    const y = random.random(height)
    const radius = random.random(width / 250)
    drawStar(ctx, x, y, radius, radius * random.random(0.3, 0.7), Math.floor(random.random(14, 22)))
  }
}

function galaxy(context: EffectRenderContext) {
  batchedGalaxy(context)
}

function voronoi({ ctx, width, height, source, seed, params, wasm }: EffectRenderContext) {
  const byteLength = width * height * 4;
  const maxSites = params.voronoiPoints;
  wasm.pfree();
  const sourcePtr = wasm.palloc(byteLength) >>> 0;
  const outputPtr = wasm.palloc(byteLength) >>> 0;
  const xsPtr = wasm.palloc(maxSites * Float32Array.BYTES_PER_ELEMENT) >>> 0;
  const ysPtr = wasm.palloc(maxSites * Float32Array.BYTES_PER_ELEMENT) >>> 0;
  const distancePtr = wasm.palloc(Float32Array.BYTES_PER_ELEMENT) >>> 0;
  const countPtr = wasm.palloc(Uint32Array.BYTES_PER_ELEMENT) >>> 0;
  new Uint8Array(wasm.memory.buffer, sourcePtr, byteLength).set(source.data);
  measureWasm('poissonSites', () => wasm.poissonSites(width, height, maxSites, seed >>> 0, xsPtr, ysPtr, distancePtr, countPtr));
  const count = new Uint32Array(wasm.memory.buffer, countPtr, 1)[0];
  const minDistance = new Float32Array(wasm.memory.buffer, distancePtr, 1)[0];
  measureWasm('voronoiCells', () => wasm.voronoiCells(sourcePtr, outputPtr, width, height, xsPtr, ysPtr, count, minDistance));
  drawPixelBuffer(ctx, width, height, outputPtr, byteLength, wasm);
}

function arrayRotate<T>(arr: T[], reverse: boolean, count: number): T[] {
  const times = Math.floor(count);
  for (let i = 0; i < times; i++) {
    if (reverse) arr.unshift(arr.pop() as T);
    else arr.push(arr.shift() as T);
  }
  return arr;
}

function readRegion(source: ImageData, x: number, y: number, width: number, height: number): ImageData {
  const image = new ImageData(width, height)
  const left = Math.max(0, Math.min(source.width, Math.round(x)))
  const top = Math.max(0, Math.min(source.height, Math.round(y)))
  const columns = Math.min(width, source.width - left)
  const rows = Math.min(height, source.height - top)
  for (let row = 0; row < rows; row++) {
    const from = ((top + row) * source.width + left) * 4
    image.data.set(source.data.subarray(from, from + columns * 4), row * width * 4)
  }
  return image
}

function filterSectionBlock(block: Surface, wasm: WasmKernels, invert: boolean, posterize: boolean) {
  if (!invert && !posterize) return
  const image = surfacePixels(block)
  const pixels = image.data
  const byteLength = pixels.length
  wasm.pfree()
  const pointer = wasm.palloc(byteLength) >>> 0
  new Uint8Array(wasm.memory.buffer, pointer, byteLength).set(pixels)
  if (invert) measureWasm('pixelFilter:invert', () => wasm.pixelFilter(pointer, byteLength / 4, 1, 0))
  if (posterize) measureWasm('pixelFilter:posterize', () => wasm.pixelFilter(pointer, byteLength / 4, 2, 2))
  pixels.set(new Uint8Array(wasm.memory.buffer, pointer, byteLength))
  block.ctx.putImageData(image, 0, 0)
}

function offsetSections({ ctx, width, height, source, random, params, wasm }: EffectRenderContext) {
  const sectionCount = Math.max(1, Math.round(params.sectionCount));
  const slices = 105;
  const maxShift = slices * Math.max(0, Math.min(100, params.sectionOffset)) / 100;
  const invertRatio = Math.max(0, Math.min(100, params.sectionInvertRatio)) / 100;
  const posterizeRatio = Math.max(0, Math.min(100, params.sectionPosterizeRatio)) / 100;
  const vertical = params.sectionDirection !== 'horizontal';
  const margin = 0.05;
  const xDivisions = vertical ? sectionCount : slices;
  const yDivisions = vertical ? slices : sectionCount;
  const blockWidth = width / xDivisions;
  const blockHeight = height / yDivisions;
  const stripCount = vertical ? xDivisions : yDivisions;
  const sliceCount = vertical ? yDivisions : xDivisions;

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;

  const block = createSurface(Math.max(1, Math.round(blockWidth)), Math.max(1, Math.round(blockHeight)));

  const strips: ImageData[][] = [];
  for (let s = 0; s < stripCount; s++) {
    const strip: ImageData[] = [];
    for (let k = 0; k < sliceCount; k++) {
      const x = vertical ? s * blockWidth : k * blockWidth;
      const y = vertical ? k * blockHeight : s * blockHeight;
      strip.push(readRegion(source, x, y, block.width, block.height));
    }
    strips.push(strip);
  }

  for (let s = 0; s < stripCount; s++) {
    const strip = arrayRotate(strips[s], random.random() < 0.4, random.random(maxShift));
    for (let k = 0; k < sliceCount; k++) {
      const invert = random.random() < invertRatio;
      const posterize = random.random() < posterizeRatio;
      block.ctx.putImageData(strip[k], 0, 0);
      filterSectionBlock(block, wasm, invert, posterize);
      const x = vertical ? s * blockWidth : k * blockWidth;
      const y = vertical ? k * blockHeight : s * blockHeight;
      const drawWidth = blockWidth * (1 - margin);
      const drawHeight = blockHeight * (1 - margin);
      ctx.drawImage(
        block.canvas,
        x + blockWidth / 2 - drawWidth / 2,
        y + blockHeight / 2 - drawHeight / 2,
        drawWidth,
        drawHeight,
      );
    }
  }
}

function detailNoise({ ctx, width, height, source, seed, params, wasm }: EffectRenderContext) {
  const byteLength = width * height * 4
  wasm.pfree()
  const sourcePtr = wasm.palloc(byteLength) >>> 0
  const outputPtr = wasm.palloc(byteLength) >>> 0
  new Uint8Array(wasm.memory.buffer, sourcePtr, byteLength).set(source.data)
  measureWasm('detailNoise', () => wasm.detailNoise(
    sourcePtr,
    outputPtr,
    width,
    height,
    params.detailNoiseMode === 'color' ? 1 : 0,
    seed >>> 0,
  ))
  drawPixelBuffer(ctx, width, height, outputPtr, byteLength, wasm)
}

function curtainGrid({ ctx, width, height, source, seed, params, wasm }: EffectRenderContext) {
  const byteLength = width * height * 4
  wasm.pfree()
  const sourcePtr = wasm.palloc(byteLength) >>> 0
  const outputPtr = wasm.palloc(byteLength) >>> 0
  new Uint8Array(wasm.memory.buffer, sourcePtr, byteLength).set(source.data)
  const effect = params.gridCurtainEffect === 'inverse' ? 1 : params.gridCurtainEffect === 'rasterize' ? 2 : 3
  measureWasm('curtainGrid', () => wasm.curtainGrid(
    sourcePtr,
    outputPtr,
    width,
    height,
    params.gridSize,
    params.gridMargin,
    params.gridCurtainCount,
    params.gridCurtainWidth,
    params.gridCurtainRandomness,
    params.gridCurtainEdgeJitter,
    params.gridCurtainAxis === 'columns' ? 1 : 0,
    effect,
    seed >>> 0,
  ))
  drawPixelBuffer(ctx, width, height, outputPtr, byteLength, wasm)
}

export const EFFECTS: Record<EffectId, EffectDefinition> = {
  'pixel-sort': {
    id: 'pixel-sort',
    label: 'Pixel sort',
    // A live pixel-sort layer sorts a share of every run, so `amount` is a real
    // control; legacy layers may still carry null, which shows as the fallback.
    defaults: { amount: 100 },
    controls: [
      { type: 'select', key: 'direction', label: 'Direction', options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ] },
      { type: 'toggle', key: 'reverse', label: '⇄ Reverse' },
      { type: 'range', key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, fallback: 100 },
      { type: 'range', key: 'randomness', label: 'Randomness', min: 0, max: 100, step: 1 },
      { type: 'toggle', key: 'containedBlocks', label: 'Contained blocks' },
      { type: 'range', key: 'spanWidth', label: 'Span width', min: 1, max: MAX_SPAN_WIDTH, step: 1 },
    ],
    render: pixelSort,
  },
  'rect': { id: 'rect', label: 'Rect', defaults: {}, controls: [], render: rect },
  'circles': { id: 'circles', label: 'Circles', defaults: {}, controls: [], render: circles },
  'grey-squares': {
    id: 'grey-squares',
    label: 'Grey squares',
    defaults: {},
    controls: [{ type: 'range', key: 'grayLevels', label: 'Gray levels', min: 2, max: 16, step: 1 }],
    render: graySquares,
  },
  'lines': { id: 'lines', label: 'Lines', defaults: {}, controls: [], render: lines },
  'vertical-lines': { id: 'vertical-lines', label: 'Vertical lines', defaults: {}, controls: [], render: verticalLines },
  'horizontal-lines': { id: 'horizontal-lines', label: 'Horizontal lines', defaults: {}, controls: [], render: horizontalLines },
  'galaxy': { id: 'galaxy', label: 'Galaxy', defaults: {}, controls: [], render: galaxy },
  'voronoi': {
    id: 'voronoi',
    label: 'Voronoi',
    defaults: { voronoiPoints: 1200 },
    controls: [{ type: 'range', key: 'voronoiPoints', label: 'Points', min: 4, max: 12000, step: 1 }],
    render: voronoi,
  },
  'sections': {
    id: 'sections',
    label: 'Sections',
    defaults: { sectionCount: 3, sectionOffset: 33, sectionDirection: 'vertical', sectionInvertRatio: 5, sectionPosterizeRatio: 20 },
    controls: [
      { type: 'range', key: 'sectionCount', label: 'Sections', min: 1, max: 20, step: 1 },
      { type: 'range', key: 'sectionOffset', label: 'Offset', min: 0, max: 100, step: 1 },
      { type: 'select', key: 'sectionDirection', label: 'Direction', options: [
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
      ] },
      { type: 'range', key: 'sectionInvertRatio', label: 'Invert', min: 0, max: 100, step: 1 },
      { type: 'range', key: 'sectionPosterizeRatio', label: 'Posterize', min: 0, max: 100, step: 1 },
    ],
    render: offsetSections,
  },
  'curtain-grid': {
    id: 'curtain-grid',
    label: 'Curtain grid',
    defaults: {
      gridSize: 90,
      gridMargin: 8,
      gridCurtainCount: 2,
      gridCurtainWidth: 35,
      gridCurtainRandomness: 40,
      gridCurtainEdgeJitter: 35,
      gridCurtainEffect: 'inverse',
      gridCurtainAxis: 'rows',
    },
    controls: [
      { type: 'range', key: 'gridSize', label: 'Squares', min: 2, max: MAX_GRID_SQUARES, step: 1 },
      { type: 'range', key: 'gridMargin', label: 'Gap', min: 0, max: 40, step: 1 },
      { type: 'range', key: 'gridCurtainCount', label: 'Curtains', min: 0, max: 8, step: 1 },
      { type: 'range', key: 'gridCurtainWidth', label: 'Curtain width', min: 1, max: 100, step: 1 },
      { type: 'range', key: 'gridCurtainRandomness', label: 'Length jitter', min: 0, max: 100, step: 1 },
      { type: 'range', key: 'gridCurtainEdgeJitter', label: 'Edge jitter', min: 0, max: 100, step: 1 },
      { type: 'select', key: 'gridCurtainEffect', label: 'Curtain filter', options: [
        { value: 'inverse', label: 'Invert' },
        { value: 'rasterize', label: 'Posterize' },
        { value: 'greyscale', label: 'Grey' },
      ] },
      { type: 'select', key: 'gridCurtainAxis', label: 'Curtain edge', options: [
        { value: 'rows', label: 'Top and bottom' },
        { value: 'columns', label: 'Left and right' },
      ] },
    ],
    render: curtainGrid,
  },
  'detail-noise': {
    id: 'detail-noise',
    label: 'Detail noise',
    defaults: {},
    controls: [{ type: 'select', key: 'detailNoiseMode', label: 'Color mode', options: [
      { value: 'bw', label: 'Black and white' },
      { value: 'color', label: 'Original color' },
    ] }],
    render: detailNoise,
  },
};

export const EFFECT_LIST: EffectDefinition[] = EFFECT_IDS.map((id) => EFFECTS[id]);

export function effectLabel(effect: EffectId): string {
  return EFFECTS[effect].label;
}
