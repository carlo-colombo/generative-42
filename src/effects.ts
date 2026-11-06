import p5 from "p5";
import { averageColorInArea, type Point } from "./color";
import { mulberry32 } from "./areas";
import { sortPixels } from "./sort";
import { poissonSites, voronoiCellPixels } from "./voronoi";
import { DEFAULT_EFFECT_PARAMS, MAX_SPAN_WIDTH } from "./types";
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
} from "./types";

export type EffectRenderContext = {
  p: p5.Graphics;
  // The composite below this layer, at canvas size.
  source: p5.Image;
  mask: Float32Array | null;
  seed: number;
  params: EffectParams;
  edge: LayerEdge;
  generation: Generation;
};

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

function pixelsToImage(p: p5.Graphics, width: number, height: number, pixels: Uint8ClampedArray): p5.Image {
  const image = p.createImage(width, height)
  image.loadPixels()
  ;(image.pixels as unknown as Uint8ClampedArray).set(pixels)
  image.updatePixels()
  return image
}

function drawPixelBuffer(p: p5.Graphics, width: number, height: number, pixels: Uint8ClampedArray) {
  p.image(pixelsToImage(p, width, height, pixels), 0, 0)
}

function rect({ p, source }: EffectRenderContext) {
  p.noStroke();

  for (let i = 0; i < 20000; i++) {
    const x = p.random(source.width);
    const y = p.random(source.height);
    const w = p.random(source.width / 20) / 2;
    const h = p.random(source.height / 20) / 2;

    const corners: [Point, Point, Point, Point] = [
      { x: x - w, y: y - h },
      { x: x + w, y: y - h },
      { x: x - w, y: y + h },
      { x: x + w, y: y + h },
    ];

    const avg = averageColorInArea(source, corners, 1000);

    p.fill(avg.r, avg.g, avg.b, p.random() * 255);
    p.stroke(avg.r, avg.g, avg.b);
    p.rect(x - w, y - h, w * 2, h * 2);
  }
}

function circles({ p, source }: EffectRenderContext) {
  for (let i = 0; i < 20000; i++) {
    const x = p.random(source.width);
    const y = p.random(source.height);
    const w = p.random(source.width / 20) / 2;
    const h = w;

    const corners: [Point, Point, Point, Point] = [
      { x: x - w, y: y - h },
      { x: x + w, y: y - h },
      { x: x - w, y: y + h },
      { x: x + w, y: y + h },
    ];

    const avg = averageColorInArea(source, corners, 1000);

    p.fill(avg.r, avg.g, avg.b, p.random() * 255);
    p.stroke(avg.r, avg.g, avg.b);
    p.circle(x, y, w * 2);
  }
}

function graySquares({ p, source, params }: EffectRenderContext) {
  p.noStroke();

  for (let i = 0; i < 20000; i++) {
    const x = p.random(source.width);
    const y = p.random(source.height);
    const halfSize = p.random(Math.min(source.width, source.height) / 40) / 2;

    const avg = averageColorInArea(source, [
      { x: x - halfSize, y: y - halfSize },
      { x: x + halfSize, y: y - halfSize },
      { x: x - halfSize, y: y + halfSize },
      { x: x + halfSize, y: y + halfSize },
    ], 1000);

    const luminance = 0.299 * avg.r + 0.587 * avg.g + 0.114 * avg.b;
    const levels = Math.max(2, Math.min(16, Math.round(params.grayLevels)));
    const step = 255 / (levels - 1);
    const squareColor = Math.round(luminance / step) * step;
    const borderColor = squareColor > 127.5 ? 0 : 255;

    p.fill(squareColor, 127.5);
    p.stroke(borderColor, 127.5);
    p.rect(x - halfSize, y - halfSize, halfSize * 2, halfSize * 2);
  }
}

function lines({ p, source }: EffectRenderContext) {
  p.strokeWeight(source.width / 700);

  for (let i = 0; i < 90000; i++) {
    const x1 = p.random(source.width);
    const y1 = p.random(source.height);
    const angle = p.random(p.TWO_PI);
    const length = p.random(Math.min(source.width, source.height) / 10);
    const x2 = x1 + Math.cos(angle) * length;
    const y2 = y1 + Math.sin(angle) * length;

    const color = x1 === x2 || y1 === y2
      ? { r: 255, g: 255, b: 255 }
      : averageColorInArea(source, [
        { x: x1, y: y1 },
        { x: x1, y: y2 },
        { x: x2, y: y2 },
        { x: x2, y: y1 },
      ], 1000);

    p.stroke(color.r, color.g, color.b);
    p.line(x1, y1, x2, y2);
  }
}

function verticalLines({ p, source }: EffectRenderContext) {
  const strokeWidth = source.width / 700;
  p.strokeWeight(strokeWidth);

  for (let i = 0; i < 90000; i++) {
    const x = p.random(source.width);
    const y1 = p.random(source.height);
    const y2 = y1 + p.random(Math.min(source.width, source.height) / 10);
    const halfWidth = strokeWidth / 2;
    const color = averageColorInArea(source, [
      { x: x - halfWidth, y: y1 },
      { x: x + halfWidth, y: y1 },
      { x: x - halfWidth, y: y2 },
      { x: x + halfWidth, y: y2 },
    ], 1000);

    p.stroke(color.r, color.g, color.b);
    p.line(x, y1, x, y2);
  }
}

function horizontalLines({ p, source }: EffectRenderContext) {
  const strokeWidth = source.width / 700;
  p.strokeWeight(strokeWidth);

  for (let i = 0; i < 90000; i++) {
    const x1 = p.random(source.width);
    const y = p.random(source.height);
    const x2 = x1 + p.random(Math.min(source.width, source.height) / 10);
    const halfWidth = strokeWidth / 2;
    const color = averageColorInArea(source, [
      { x: x1, y: y - halfWidth },
      { x: x2, y: y - halfWidth },
      { x: x1, y: y + halfWidth },
      { x: x2, y: y + halfWidth },
    ], 1000);

    p.stroke(color.r, color.g, color.b);
    p.line(x1, y, x2, y);
  }
}

function pixelSort({ p, source, mask, seed, params, edge }: EffectRenderContext) {
  source.loadPixels();
  const sorted = sortPixels(
    source.pixels as unknown as Uint8ClampedArray,
    source.width,
    source.height,
    mask,
    {
      direction: params.direction,
      reverse: params.reverse,
      randomness: params.randomness,
      spanWidth: params.spanWidth,
      containedBlocks: params.containedBlocks,
      jitter: edge.mode === 'ragged' ? edge.jitter : 0,
      amount: params.amount,
    },
    mulberry32(seed),
  );
  drawPixelBuffer(p, source.width, source.height, sorted);
}

function drawStar(p: p5.Graphics, x: number, y: number, outer: number, inner: number, points: number) {
  p.beginShape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    p.vertex(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  p.endShape(p.CLOSE);
}

function galaxy({ p, source }: EffectRenderContext) {
  p.noStroke();

  for (let i = 0; i < 20000; i++) {
    const x = p.random(source.width);
    const y = p.random(source.height);
    const radius = p.random(source.width / 30);

    const corners: [Point, Point, Point, Point] = [
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius },
    ];

    const avg = averageColorInArea(source, corners, 1000);

    p.fill(avg.r, avg.g, avg.b, p.random() * 255);
    drawStar(p, x, y, radius, radius * p.random(0.6, 0.7), Math.floor(p.random(7, 12)));
  }

  p.fill(255, 255, 255, 140);

  for (let i = 0; i < 300; i++) {
    const x = p.random(source.width);
    const y = p.random(source.height);
    const radius = p.random(source.width / 250);

    drawStar(p, x, y, radius, radius * p.random(0.3, 0.7), Math.floor(p.random(14, 22)));
  }
}

function voronoi({ p, source, seed, params }: EffectRenderContext) {
  source.loadPixels();
  const sites = poissonSites(source.width, source.height, params.voronoiPoints, seed);
  const pixels = voronoiCellPixels(
    source.pixels as unknown as Uint8ClampedArray,
    source.width,
    source.height,
    sites.points,
    sites.minDistance,
  );
  drawPixelBuffer(p, source.width, source.height, pixels);
}

function arrayRotate<T>(arr: T[], reverse: boolean, count: number): T[] {
  const times = Math.floor(count);
  for (let i = 0; i < times; i++) {
    if (reverse) arr.unshift(arr.pop() as T);
    else arr.push(arr.shift() as T);
  }
  return arr;
}

function offsetSections({ p, source, params }: EffectRenderContext) {
  const sectionCount = Math.max(1, Math.round(params.sectionCount));
  const slices = 105;
  const maxShift = slices * Math.max(0, Math.min(100, params.sectionOffset)) / 100;
  const invertRatio = Math.max(0, Math.min(100, params.sectionInvertRatio)) / 100;
  const posterizeRatio = Math.max(0, Math.min(100, params.sectionPosterizeRatio)) / 100;
  const vertical = params.sectionDirection !== 'horizontal';
  const margin = 0.05;
  const xDivisions = vertical ? sectionCount : slices;
  const yDivisions = vertical ? slices : sectionCount;
  const blockWidth = source.width / xDivisions;
  const blockHeight = source.height / yDivisions;
  const stripCount = vertical ? xDivisions : yDivisions;
  const sliceCount = vertical ? yDivisions : xDivisions;

  p.background(255);
  p.imageMode(p.CENTER);

  const strips: p5.Image[][] = [];
  for (let s = 0; s < stripCount; s++) {
    const strip: p5.Image[] = [];
    for (let k = 0; k < sliceCount; k++) {
      const x = vertical ? s * blockWidth : k * blockWidth;
      const y = vertical ? k * blockHeight : s * blockHeight;
      strip.push(source.get(x, y, blockWidth, blockHeight));
    }
    strips.push(strip);
  }

  for (let s = 0; s < stripCount; s++) {
    const strip = arrayRotate(strips[s], p.random() < 0.4, p.random(maxShift));
    for (let k = 0; k < sliceCount; k++) {
      const block = strip[k];
      if (p.random() < invertRatio) block.filter(p.INVERT);
      if (p.random() < posterizeRatio) block.filter(p.POSTERIZE, 2);
      const x = vertical ? s * blockWidth : k * blockWidth;
      const y = vertical ? k * blockHeight : s * blockHeight;
      p.push();
      p.translate(x + blockWidth / 2, y + blockHeight / 2);
      block.resize(blockWidth * (1 - margin), blockHeight * (1 - margin));
      p.image(block, 0, 0);
      p.pop();
    }
  }
}

function poissonSample(p: p5.Graphics, lambda: number): number {
  const L = Math.exp(-lambda);
  let k = 0;
  let prod = 1;
  do {
    k++;
    prod *= p.random();
  } while (prod > L);
  return k - 1;
}

function regionSum(integral: Float64Array, iw: number, x0: number, y0: number, x1: number, y1: number): number {
  return integral[y1 * iw + x1] - integral[y0 * iw + x1] - integral[y1 * iw + x0] + integral[y0 * iw + x0];
}

function detailNoise({ p, source, params }: EffectRenderContext) {
  source.loadPixels();
  const w = source.width;
  const h = source.height;
  const lum = new Float32Array(w * h);
  for (let i = 0, pi = 0; i < lum.length; i++, pi += 4) {
    lum[i] = 0.299 * source.pixels[pi] + 0.587 * source.pixels[pi + 1] + 0.114 * source.pixels[pi + 2];
  }

  const iw = w + 1;
  const integral = new Float64Array(iw * (h + 1));
  const integralSq = new Float64Array(iw * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    let rowSq = 0;
    for (let x = 0; x < w; x++) {
      const v = lum[y * w + x];
      row += v;
      rowSq += v * v;
      const idx = (y + 1) * iw + (x + 1);
      integral[idx] = integral[y * iw + (x + 1)] + row;
      integralSq[idx] = integralSq[y * iw + (x + 1)] + rowSq;
    }
  }

  const radius = Math.max(1, Math.round(Math.min(w, h) / 80));
  const details = new Float32Array(w * h);
  let maxDetail = 1e-6;
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(h, y + radius + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(w, x + radius + 1);
      const n = (x1 - x0) * (y1 - y0);
      const sum = regionSum(integral, iw, x0, y0, x1, y1);
      const sumSq = regionSum(integralSq, iw, x0, y0, x1, y1);
      const mean = sum / n;
      const detail = Math.sqrt(Math.max(0, sumSq / n - mean * mean));
      details[y * w + x] = detail;
      if (detail > maxDetail) maxDetail = detail;
    }
  }

  const lambda = 8;
  const out = p.createImage(w, h);
  out.loadPixels();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const detail = details[y * w + x] / maxDetail;
      const noise = poissonSample(p, lambda) / lambda;
      const value = noise * detail;
      const v = Math.max(0, Math.min(255, Math.round(value * 255)));
      const i = (y * w + x) * 4;
      if (params.detailNoiseMode === 'color') {
        out.pixels[i] = Math.round(source.pixels[i] * value);
        out.pixels[i + 1] = Math.round(source.pixels[i + 1] * value);
        out.pixels[i + 2] = Math.round(source.pixels[i + 2] * value);
      } else {
        out.pixels[i] = v;
        out.pixels[i + 1] = v;
        out.pixels[i + 2] = v;
      }
      out.pixels[i + 3] = 255;
    }
  }
  out.updatePixels();
  p.image(out, 0, 0);
}

function fillPixelRect(
  pixels: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
  g: number,
  b: number,
) {
  const left = Math.max(0, x0)
  const right = Math.min(width, x1)
  if (right <= left) return
  for (let y = Math.max(0, y0); y < y1; y++) {
    let i = (y * width + left) * 4
    for (let x = left; x < right; x++) {
      pixels[i] = r
      pixels[i + 1] = g
      pixels[i + 2] = b
      pixels[i + 3] = 255
      i += 4
    }
  }
}

function curtainGrid({ p, source, seed, params }: EffectRenderContext) {
  const w = source.width
  const h = source.height
  source.loadPixels()
  const src = source.pixels as unknown as Uint8ClampedArray

  const squares = Math.max(2, Math.round(params.gridSize))
  const cell = Math.min(w, h) / squares
  const cols = Math.max(1, Math.ceil(w / cell - 1e-6))
  const rows = Math.max(1, Math.ceil(h / cell - 1e-6))
  const cells = cols * rows

  // One pass over the source collects every cell average and the frame colour.
  const avg = new Float32Array(cells * 3)
  let totalR = 0
  let totalG = 0
  let totalB = 0
  let total = 0
  for (let row = 0; row < rows; row++) {
    const y0 = Math.round(row * cell)
    const y1 = Math.min(h, Math.round((row + 1) * cell))
    for (let col = 0; col < cols; col++) {
      const x0 = Math.round(col * cell)
      const x1 = Math.min(w, Math.round((col + 1) * cell))
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let y = y0; y < y1; y++) {
        let i = (y * w + x0) * 4
        for (let x = x0; x < x1; x++, i += 4) {
          r += src[i]
          g += src[i + 1]
          b += src[i + 2]
          n++
        }
      }
      const index = (row * cols + col) * 3
      if (n === 0) n = 1
      avg[index] = r / n
      avg[index + 1] = g / n
      avg[index + 2] = b / n
      totalR += r
      totalG += g
      totalB += b
      total += n
    }
  }
  if (total === 0) total = 1
  const bgR = Math.round(totalR / total)
  const bgG = Math.round(totalG / total)
  const bgB = Math.round(totalB / total)

  // Curtains are edge-anchored runs of cells. Every cell row (or column) inside
  // one draws its own length, so the curtain border stays irregular.
  const axis = params.gridCurtainAxis === 'columns' ? 'columns' : 'rows'
  const along = axis === 'columns' ? cols : rows
  const across = axis === 'columns' ? rows : cols
  const bandCount = Math.max(0, Math.round(params.gridCurtainCount))
  const bandWidth = Math.min(1, Math.max(0, params.gridCurtainWidth) / 100)
  const bandJitter = Math.min(1, Math.max(0, params.gridCurtainRandomness) / 100)
  const edgeJitter = Math.min(1, Math.max(0, params.gridCurtainEdgeJitter) / 100)
  const hasCurtain = bandCount > 0 && bandWidth > 0
  const inCurtain = new Uint8Array(cells)
  if (hasCurtain) {
    const rand = mulberry32(seed)
    for (let i = 0; i < bandCount; i++) {
      const length = Math.min(1, Math.max(0.02, bandWidth + (rand() * 2 - 1) * bandJitter))
      const baseSpan = Math.min(along, Math.max(1, Math.round(along * length)))
      const fromStart = rand() < 0.5
      const wobbleRange = baseSpan * edgeJitter
      for (let line = 0; line < across; line++) {
        const wobble = Math.round((rand() * 2 - 1) * wobbleRange)
        const span = Math.min(along, Math.max(1, baseSpan + wobble))
        for (let k = 0; k < span; k++) {
          const pos = fromStart ? k : along - 1 - k
          inCurtain[axis === 'columns' ? line * cols + pos : pos * cols + line] = 1
        }
      }
    }
  }

  const buffer = new Uint8ClampedArray(w * h * 4)
  fillPixelRect(buffer, w, 0, 0, w, h, bgR, bgG, bgB)
  const curtainBuffer = hasCurtain ? new Uint8ClampedArray(w * h * 4) : null
  if (curtainBuffer) {
    for (let row = 0; row < rows; row++) {
      const y0 = Math.round(row * cell)
      const y1 = Math.min(h, Math.round((row + 1) * cell))
      for (let col = 0; col < cols; col++) {
        if (!inCurtain[row * cols + col]) continue
        const x0 = Math.round(col * cell)
        const x1 = Math.min(w, Math.round((col + 1) * cell))
        fillPixelRect(curtainBuffer, w, x0, y0, x1, y1, bgR, bgG, bgB)
      }
    }
  }

  const margin = Math.max(0, Math.round((cell * Math.max(0, params.gridMargin)) / 100))
  for (let row = 0; row < rows; row++) {
    const y0 = Math.round(row * cell)
    const y1 = Math.min(h, Math.round((row + 1) * cell))
    for (let col = 0; col < cols; col++) {
      const x0 = Math.round(col * cell)
      const x1 = Math.min(w, Math.round((col + 1) * cell))
      const index = row * cols + col
      const r = Math.round(avg[index * 3])
      const g = Math.round(avg[index * 3 + 1])
      const b = Math.round(avg[index * 3 + 2])
      const borderR = Math.round(r * 0.3 + 178.5)
      const borderG = Math.round(g * 0.3 + 178.5)
      const borderB = Math.round(b * 0.3 + 178.5)
      const sx0 = x0 + margin
      const sy0 = y0 + margin
      const targets = curtainBuffer && inCurtain[index] ? [buffer, curtainBuffer] : [buffer]
      for (const target of targets) {
        fillPixelRect(target, w, sx0, sy0, x1, y1, borderR, borderG, borderB)
        fillPixelRect(target, w, sx0 + 1, sy0 + 1, x1 - 1, y1 - 1, r, g, b)
      }
    }
  }

  p.image(pixelsToImage(p, w, h, buffer), 0, 0)
  if (curtainBuffer) {
    const layer = pixelsToImage(p, w, h, curtainBuffer)
    if (params.gridCurtainEffect === 'greyscale') layer.filter(p.GRAY)
    else if (params.gridCurtainEffect === 'rasterize') layer.filter(p.POSTERIZE, 4)
    else layer.filter(p.INVERT)
    p.image(layer, 0, 0)
  }
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
