import p5 from "p5";
import type { Generation } from "./types";
import { DRAWS } from "./draws";

export function createSketch(gen: Generation) {
  let font: p5.Font;
  let img: p5.Image;

  const drawFn = DRAWS[gen.draw] ?? DRAWS["random-rect"];

  const sketch = (p: p5) => {
    p.preload = () => {
      font = p.loadFont(gen.font);
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

      const align = gen.textAlign;
      const alpha = Math.round((gen.textOpacity / 100) * 255);
      p.textSize(gen.textSize);
      p.textAlign(align);
      p.fill(255, alpha);
      p.stroke(255, alpha);
      const lineX =
        align === "center" ? p.width / 2 : align === "left" ? 20 : p.width * 0.95;
      const text = gen.text
        .toUpperCase()
        .split("\n")
        .map((l) => l.trim())
        .join("\n");
      const lines = text.split("\n").length;
      const blockHeight =
        p.textAscent() + p.textDescent() + (lines - 1) * p.textLeading();
      const margin = 20;
      const topSafeSpace = 60;
      const y =
        gen.textVAlign === "top"
          ? topSafeSpace + p.textAscent()
          : gen.textVAlign === "bottom"
            ? p.height -
              p.textDescent() -
              margin -
              (lines - 1) * p.textLeading()
            : p.height / 2 - blockHeight / 2 + p.textAscent();
      p.text(text, lineX, y);

      p.textAlign(p.LEFT);
      p.fill(255);
      p.noStroke();
      p.textFont(font);
      const unit = Math.min(p.width, p.height) / 926;
      p.textSize(24 * unit);
      p.text(`seed=${gen.seed}`, 20 * unit, 40 * unit);

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
