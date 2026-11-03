import p5 from "p5";
import { averageColorInArea, type Point } from "./color";
import { mulberry32 } from "./areas";
import { sortPixels } from "./sort";
import { DEFAULT_EFFECT_PARAMS } from "./types";
import type {
  ColorSortDirection,
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
  | { type: 'range'; key: keyof EffectParams; label: string; min: number; max: number; step: number }
  | { type: 'select'; key: keyof EffectParams; label: string; options: { value: string; label: string }[] }
  | { type: 'toggle'; key: keyof EffectParams; label: string };

export type EffectDefinition = {
  id: EffectId;
  label: string;
  defaults: Partial<EffectParams>;
  controls: EffectControl[];
  render: (context: EffectRenderContext) => void;
};

const EFFECT_IDS: EffectId[] = [
  'pixel-sort',
  'galaxy',
  'sections',
  'detail-noise',
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
  };
}

function drawPixelBuffer(p: p5.Graphics, width: number, height: number, pixels: Uint8ClampedArray) {
  const image = p.createImage(width, height)
  image.loadPixels()
  ;(image.pixels as unknown as Uint8ClampedArray).set(pixels)
  image.updatePixels()
  p.image(image, 0, 0)
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

export const EFFECTS: Record<EffectId, EffectDefinition> = {
  'pixel-sort': {
    id: 'pixel-sort',
    label: 'Pixel sort',
    defaults: {},
    controls: [
      { type: 'select', key: 'direction', label: 'Direction', options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ] },
      { type: 'toggle', key: 'reverse', label: '⇄ Reverse' },
      { type: 'range', key: 'randomness', label: 'Randomness', min: 0, max: 100, step: 1 },
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
