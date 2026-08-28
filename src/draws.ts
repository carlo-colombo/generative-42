import p5 from "p5";
import { averageColorInArea, type Point } from "./color";

export interface DrawContext {
  p: p5;
  img: p5.Image;
  text: string;
  seed: number;
}

export type DrawFunction = (ctx: DrawContext) => void;

function randomRect({ p, img }: DrawContext) {
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

function randomCircles({p,img}: DrawContext) {
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

function randomLines({ p, img }: DrawContext) {
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

export const DRAWS: Record<string, DrawFunction> = {
  "random-rect": randomRect,
  "random-circles": randomCircles,
  "random-lines": randomLines,
  "galaxy": galaxy
};
