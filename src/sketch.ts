import p5 from "p5";
import type { Generation } from "./types";
import { DRAWS } from "./draws";

export function createSketch(gen: Generation) {
  let font: p5.Font;
  let img: p5.Image;

  const drawFn = DRAWS[gen.draw] ?? DRAWS["random-rect"];

  const sketch = (p: p5) => {
    p.preload = () => {
      font = p.loadFont("/fonts/SpaceMono-Regular.ttf");
      img = p.loadImage(gen.image);
    };

    p.setup = () => {
      p.pixelDensity(1);
      p.createCanvas(img.width, img.height);
      p.rectMode(p.CENTER);
      p.noLoop();
      p.randomSeed(gen.seed);
      p.noiseSeed(gen.seed);
      p.draw();
    };

    p.draw = () => {
      drawFn({ p, img, text: gen.text, seed: gen.seed });

      p.textAlign(p.LEFT);
      p.fill(255);
      p.noStroke();
      p.textFont(font);
      p.textSize(24);
      p.text(`seed: ${gen.seed}`, 20, 40);

      p.textSize(375);
      p.textAlign(p.RIGHT);
      p.stroke(255);
      const lineX = p.width * 0.95;
      const text = gen.text.toUpperCase();
      const lines = text.split("\n").length;
      const blockHeight =
        p.textAscent() + p.textDescent() + (lines - 1) * p.textLeading();
      const y = p.height / 2 - blockHeight / 2 + p.textAscent();
      p.text(text, lineX, y);

      p.noLoop();
    };
  };

  return sketch;
}

export function extractImage(canvas: HTMLCanvasElement): string {
  return canvas.toDataURL("image/png");
}

export function downloadImage(canvas: HTMLCanvasElement, filename: string) {
  const link = document.createElement("a");
  link.download = filename;
  link.href = canvas.toDataURL("image/png", 1.0);
  link.click();
}
