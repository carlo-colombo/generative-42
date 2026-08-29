import p5 from "p5";
import type { Generation } from "./types";
import { DRAWS } from "./draws";
import { cropImage } from './crop';

export function createSketch(gen: Generation) {
  let font: p5.Font;
  let font2: p5.Font;
  let img: p5.Image;

  const drawDefinition = DRAWS[gen.draw] ?? DRAWS["rect"];
  const drawFn = drawDefinition.draw;

  const sketch = (p: p5) => {
    p.preload = () => {
      font = p.loadFont(gen.font);
      font2 = p.loadFont(gen.text2Font);
      img = p.loadImage(gen.image);
    };

    p.setup = () => {
      p.pixelDensity(1);
      img = cropImage(img, gen);
      p.createCanvas(img.width, img.height);
      p.rectMode(p.CENTER);
      p.noLoop();
      p.randomSeed(gen.seed);
      p.noiseSeed(gen.seed);
      p.draw();
    };

    p.draw = () => {
      drawFn({ p, img, text: gen.text, seed: gen.seed, generation: gen });

      drawText(
        p,
        gen.text,
        gen.textSize,
        gen.textOpacity,
        gen.textX,
        gen.textY,
        gen.textAlign,
        gen.textVAlign,
        font
      );
      if (gen.text2) {
        drawText(
          p,
          gen.text2,
          gen.text2Size,
          gen.text2Opacity,
          gen.text2X,
          gen.text2Y,
          gen.text2Align,
          gen.text2VAlign,
          font2
        );
      }

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

  function drawText(
    p: p5,
    value: string,
    size: number,
    opacity: number,
    x: number,
    y: number,
    align: Generation["textAlign"],
    vAlign: Generation["textVAlign"],
    loadedFont: p5.Font
  ) {
    const alpha = Math.round((opacity / 100) * 255);
    p.noStroke();
    p.textFont(loadedFont);
    p.textSize(size);
    p.textAlign(align);
    p.fill(255, alpha);
    const text = value
      .toUpperCase()
      .split("\n")
      .map((line) => line.trim())
      .join("\n");
    const lines = text.split("\n").length;
    const blockHeight =
      p.textAscent() + p.textDescent() + (lines - 1) * p.textLeading();
    const lineX = (p.width * x) / 100;
    const positionY = (p.height * y) / 100;
    const baseline =
      vAlign === "top"
        ? positionY + p.textAscent()
        : vAlign === "bottom"
          ? positionY - p.textDescent() - (lines - 1) * p.textLeading()
          : positionY - blockHeight / 2 + p.textAscent();
    p.text(text, lineX, baseline);
  }

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
