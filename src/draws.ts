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

export const DRAWS: Record<string, DrawFunction> = {
  "random-rect": randomRect,
};
