import p5 from "p5";
import { averageColorInArea, type Point } from "./color";
import type { Generation } from "./types";

export interface DrawContext {
  p: p5;
  img: p5.Image;
  text: string;
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
  field: 'grayLevels' | 'colorSortAmount';
} | {
  type: 'select';
  label: string;
  field: 'colorSortDirection';
  options: { value: string; label: string }[];
};

export type DrawDefinition = {
  draw: DrawFunction;
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

function colorSorting({ p, img, generation }: DrawContext) {
  img.loadPixels()
  const sorted = p.createImage(img.width, img.height)
  sorted.loadPixels()
  const amount = Math.max(0, Math.min(100, generation.colorSortAmount))
  const horizontal = generation.colorSortDirection === 'horizontal'
  const lineLength = horizontal ? img.width : img.height

  for (let line = 0; line < (horizontal ? img.height : img.width); line++) {
    const lineAmount = Math.max(0, Math.min(100, amount * p.random(0.85, 1.15)))
    const sortedLength = Math.round(lineLength * lineAmount / 100)
    const positions = Array.from({ length: sortedLength }, (_, position) => position)
    if (sortedLength > 1) {
      positions.sort((a, b) => {
        const aIndex = (horizontal ? line * img.width + a : a * img.width + line) * 4
        const bIndex = (horizontal ? line * img.width + b : b * img.width + line) * 4
        const aLuminance = 0.299 * img.pixels[aIndex] + 0.587 * img.pixels[aIndex + 1] + 0.114 * img.pixels[aIndex + 2]
        const bLuminance = 0.299 * img.pixels[bIndex] + 0.587 * img.pixels[bIndex + 1] + 0.114 * img.pixels[bIndex + 2]
        return aLuminance - bLuminance
      })
    }

    for (let position = 0; position < lineLength; position++) {
      const sourcePosition = position < sortedLength ? positions[position] : position
      const sourceIndex = (horizontal ? line * img.width + sourcePosition : sourcePosition * img.width + line) * 4
      const targetIndex = (horizontal ? line * img.width + position : position * img.width + line) * 4
      sorted.pixels[targetIndex] = img.pixels[sourceIndex]
      sorted.pixels[targetIndex + 1] = img.pixels[sourceIndex + 1]
      sorted.pixels[targetIndex + 2] = img.pixels[sourceIndex + 2]
      sorted.pixels[targetIndex + 3] = img.pixels[sourceIndex + 3]
    }
  }

  sorted.updatePixels()
  p.image(sorted, 0, 0)
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
  "galaxy": { draw: galaxy }
};
