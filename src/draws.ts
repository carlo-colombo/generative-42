import p5 from "p5";
import { averageColorInArea, type Point } from "./color";
import { legacySortArea, seededAreaRandom, soloAreas, sortAreas } from "./sort";
import type { Generation } from "./types";

export interface DrawContext {
  p: p5;
  img: p5.Image;
  seed: number;
  generation: Generation;
}

export type DrawFunction = (ctx: DrawContext) => void;

export type DrawControl = {
  type: 'range';
  label: string;
  min: number;
  max: number;
  step: number;
  field: 'grayLevels' | 'colorSortAmount' | 'sectionCount' | 'sectionOffset' | 'sectionInvertRatio' | 'sectionPosterizeRatio';
} | {
  type: 'select';
  label: string;
  field: 'colorSortDirection' | 'sectionDirection' | 'detailNoiseMode';
  options: { value: string; label: string }[];
};

export type DrawDefinition = {
  draw: DrawFunction;
  label?: string;
  controls?: DrawControl[];
};

function rect({ p, img }: DrawContext) {
  p.noStroke();

  for (let i = 0; i < 20000; i++) {
    const x = p.random(img.width);
    const y = p.random(img.height);
    const w = p.random(img.width / 20) / 2;
    const h = p.random(img.height / 20) / 2;

    const corners: [Point, Point, Point, Point] = [
      { x: x - w, y: y - h },
      { x: x + w, y: y - h },
      { x: x - w, y: y + h },
      { x: x + w, y: y + h },
    ];

    const avg = averageColorInArea(img, corners, 1000);

    p.fill(avg.r, avg.g, avg.b, p.random() * 255);
    p.stroke(avg.r, avg.g, avg.b);
    p.rect(x, y, w * 2, h * 2);
  }
}

function circles({p,img}: DrawContext) {
  for (let i = 0; i < 20000; i++) {
    const x = p.random(img.width);
    const y = p.random(img.height);
    const w = p.random(img.width / 20) / 2;
    const h = w;

    const corners: [Point, Point, Point, Point] = [
      { x: x - w, y: y - h },
      { x: x + w, y: y - h },
      { x: x - w, y: y + h },
      { x: x + w, y: y + h },
    ];

    const avg = averageColorInArea(img, corners, 1000);

    p.fill(avg.r, avg.g, avg.b, p.random() * 255);
    p.stroke(avg.r, avg.g, avg.b);
    p.circle(x, y, w * 2);
  }
}

function graySquares({ p, img, generation }: DrawContext) {
  p.noStroke();

  for (let i = 0; i < 20000; i++) {
    const x = p.random(img.width);
    const y = p.random(img.height);
    const halfSize = p.random(Math.min(img.width, img.height) / 40) / 2;

    const avg = averageColorInArea(img, [
      { x: x - halfSize, y: y - halfSize },
      { x: x + halfSize, y: y - halfSize },
      { x: x - halfSize, y: y + halfSize },
      { x: x + halfSize, y: y + halfSize },
    ], 1000);

    const luminance = 0.299 * avg.r + 0.587 * avg.g + 0.114 * avg.b;
    const levels = Math.max(2, Math.min(16, generation.grayLevels));
    const step = 255 / (levels - 1);
    const squareColor = Math.round(luminance / step) * step;
    const borderColor = squareColor > 127.5 ? 0 : 255;

    p.fill(squareColor, 127.5);
    p.stroke(borderColor, 127.5);
    p.rect(x - halfSize, y - halfSize, halfSize * 2, halfSize * 2);
  }
}

function lines({ p, img }: DrawContext) {
  p.strokeWeight(img.width/700);

  for (let i = 0; i < 90000; i++) {
    const x1 = p.random(img.width);
    const y1 = p.random(img.height);
    const angle = p.random(p.TWO_PI);
    const length = p.random(Math.min(img.width, img.height) / 10);
    const x2 = x1 + Math.cos(angle) * length;
    const y2 = y1 + Math.sin(angle) * length;

    const color = x1 === x2 || y1 === y2
      ? { r: 255, g: 255, b: 255 }
      : averageColorInArea(img, [
        { x: x1, y: y1 },
        { x: x1, y: y2 },
        { x: x2, y: y2 },
        { x: x2, y: y1 },
      ], 1000);

    p.stroke(color.r, color.g, color.b);
    p.line(x1, y1, x2, y2);
  }
}

function verticalLines({ p, img }: DrawContext) {
  const strokeWidth = img.width / 700;
  p.strokeWeight(strokeWidth);

  for (let i = 0; i < 90000; i++) {
    const x = p.random(img.width);
    const y1 = p.random(img.height);
    const y2 = y1 + p.random(Math.min(img.width, img.height) / 10);
    const halfWidth = strokeWidth / 2;
    const color = averageColorInArea(img, [
      { x: x - halfWidth, y: y1 },
      { x: x + halfWidth, y: y1 },
      { x: x - halfWidth, y: y2 },
      { x: x + halfWidth, y: y2 },
    ], 1000);

    p.stroke(color.r, color.g, color.b);
    p.line(x, y1, x, y2);
  }
}

function horizontalLines({ p, img }: DrawContext) {
  const strokeWidth = img.width / 700;
  p.strokeWeight(strokeWidth);

  for (let i = 0; i < 90000; i++) {
    const x1 = p.random(img.width);
    const y = p.random(img.height);
    const x2 = x1 + p.random(Math.min(img.width, img.height) / 10);
    const halfWidth = strokeWidth / 2;
    const color = averageColorInArea(img, [
      { x: x1, y: y - halfWidth },
      { x: x2, y: y - halfWidth },
      { x: x1, y: y + halfWidth },
      { x: x2, y: y + halfWidth },
    ], 1000);

    p.stroke(color.r, color.g, color.b);
    p.line(x1, y, x2, y);
  }
}

function drawPixels(p: p5, width: number, height: number, pixels: Uint8ClampedArray) {
  const image = p.createImage(width, height)
  image.loadPixels()
  ;(image.pixels as unknown as Uint8ClampedArray).set(pixels)
  image.updatePixels()
  p.image(image, 0, 0)
}

function colorSorting({ p, img, generation }: DrawContext) {
  img.loadPixels()
  const source = img.pixels as unknown as Uint8ClampedArray
  // The legacy draw keeps p5's seeded stream (one draw per line) so its output is
  // pixel-identical to before; stored areas use mulberry32 instead.
  const sorted = sortAreas(
    source,
    img.width,
    img.height,
    [legacySortArea(generation)],
    'layers',
    generation.seed,
    () => () => p.random(),
  )
  drawPixels(p, img.width, img.height, sorted)
}

function pixelSortAreas({ p, img, generation }: DrawContext) {
  img.loadPixels()
  const source = img.pixels as unknown as Uint8ClampedArray
  const sorted = sortAreas(
    source,
    img.width,
    img.height,
    soloAreas(generation.areas, generation.soloAreaId),
    generation.areasMode,
    generation.seed,
    seededAreaRandom(generation.seed),
  )
  drawPixels(p, img.width, img.height, sorted)
}

function drawStar(p: p5, x: number, y: number, outer: number, inner: number, points: number) {
  p.beginShape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    p.vertex(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  p.endShape(p.CLOSE);
}

function galaxy({p,img}: DrawContext) {
  p.noStroke();

  for (let i = 0; i < 20000; i++) {
    const x = p.random(img.width);
    const y = p.random(img.height);
    const radius = p.random(img.width / 30);

    const corners: [Point, Point, Point, Point] = [
      { x: x - radius, y: y - radius },
      { x: x + radius, y: y - radius },
      { x: x - radius, y: y + radius },
      { x: x + radius, y: y + radius },
    ];

    const avg = averageColorInArea(img, corners, 1000);

    p.fill(avg.r, avg.g, avg.b, p.random() * 255);
    drawStar(p, x, y, radius, radius * p.random(0.6, 0.7), Math.floor(p.random(7, 12)));
  }

  p.fill(255,255,255, 140);

  for (let i = 0; i < 300; i++) {
    const x = p.random(img.width);
    const y = p.random(img.height);
    const radius = p.random(img.width / 250);

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

function offsetSections({ p, img, generation }: DrawContext) {
  const sectionCount = Math.max(1, Math.round(generation.sectionCount));
  const slices = 105;
  const maxShift = slices * Math.max(0, Math.min(100, generation.sectionOffset)) / 100;
  const invertRatio = Math.max(0, Math.min(100, generation.sectionInvertRatio)) / 100;
  const posterizeRatio = Math.max(0, Math.min(100, generation.sectionPosterizeRatio)) / 100;
  const vertical = generation.sectionDirection !== 'horizontal';
  const margin = 0.05;
  const xDivisions = vertical ? sectionCount : slices;
  const yDivisions = vertical ? slices : sectionCount;
  const blockWidth = img.width / xDivisions;
  const blockHeight = img.height / yDivisions;
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
      strip.push(img.get(x, y, blockWidth, blockHeight));
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

function poissonSample(p: p5, lambda: number): number {
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

function detailNoise({ p, img, generation }: DrawContext) {
  img.loadPixels();
  const w = img.width;
  const h = img.height;
  const lum = new Float32Array(w * h);
  for (let i = 0, pi = 0; i < lum.length; i++, pi += 4) {
    lum[i] = 0.299 * img.pixels[pi] + 0.587 * img.pixels[pi + 1] + 0.114 * img.pixels[pi + 2];
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
      if (generation.detailNoiseMode === 'color') {
        out.pixels[i] = Math.round(img.pixels[i] * value);
        out.pixels[i + 1] = Math.round(img.pixels[i + 1] * value);
        out.pixels[i + 2] = Math.round(img.pixels[i + 2] * value);
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

export const DRAWS: Record<string, DrawDefinition> = {
  "rect": { draw: rect },
  "circles": { draw: circles },
  "grey-squares": {
    draw: graySquares,
    controls: [{ type: 'range', label: 'Gray levels', min: 2, max: 16, step: 1, field: 'grayLevels' }],
  },
  "lines": { draw: lines },
  "vertical-lines": { draw: verticalLines },
  "horizontal-lines": { draw: horizontalLines },
  "color-sorting": {
    draw: colorSorting,
    controls: [
      { type: 'range', label: 'Color sorting amount', min: 0, max: 100, step: 1, field: 'colorSortAmount' },
      { type: 'select', label: 'Color sorting direction', field: 'colorSortDirection', options: [
        { value: 'horizontal', label: 'Horizontal' },
        { value: 'vertical', label: 'Vertical' },
      ] },
    ],
  },
  "pixel-sort-areas": {
    draw: pixelSortAreas,
    label: 'Pixel sorting areas',
  },
  "galaxy": { draw: galaxy },
  "sections": {
    draw: offsetSections,
    controls: [
      { type: 'range', label: 'Sections', min: 1, max: 20, step: 1, field: 'sectionCount' },
      { type: 'range', label: 'Offset', min: 0, max: 100, step: 1, field: 'sectionOffset' },
      { type: 'select', label: 'Direction', field: 'sectionDirection', options: [
        { value: 'vertical', label: 'Vertical' },
        { value: 'horizontal', label: 'Horizontal' },
      ] },
      { type: 'range', label: 'Invert', min: 0, max: 100, step: 1, field: 'sectionInvertRatio' },
      { type: 'range', label: 'Posterize', min: 0, max: 100, step: 1, field: 'sectionPosterizeRatio' },
    ],
  },
  "detail-noise": {
    draw: detailNoise,
    controls: [{ type: 'select', label: 'Color mode', field: 'detailNoiseMode', options: [
      { value: 'bw', label: 'Black and white' },
      { value: 'color', label: 'Original color' },
    ] }],
  },
};
