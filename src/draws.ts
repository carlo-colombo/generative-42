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
  field: 'grayLevels';
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
  "galaxy": { draw: galaxy }
};
