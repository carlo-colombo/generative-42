import p5 from "p5";
import type { Generation } from "./types";
import {averageColorInArea, type Point} from "./color"

export function createSketch(gen: Generation) {
  let font: p5.Font;
  let img: p5.Image;

  const sketch = (p: p5) => {
    p.preload = () => {
      font = p.loadFont("/fonts/SpaceMono-Regular.ttf");
      img = p.loadImage("/assets/door.jpg");
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
      //p.image(img, 0, 0);
      p.noStroke()

      for (let i = 0; i < 20000; i++) {
        const x = p.random(img.width);
        const y = p.random(img.height);
        const w = p.random(img.width/20)/2;
        const h = p.random(img.height/20)/2;

        const corners: [Point, Point, Point, Point] = [
          {x: x-w, y: y-h},
          {x: x+w, y: y-h},
          {x: x-w, y: y+h},
          {x: x+w, y: y+h},
        ]

        const avg = averageColorInArea(img, corners, 1000)

        p.fill(avg.r, avg.g, avg.b, p.random()*255)
        p.stroke(avg.r, avg.g, avg.b)
        p.rect(x,y, w*2, h*2)
      }


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
      const text = 'ATTENZIONE\nAL\nLEOPARDO';
      const lines = text.split('\n').length;
      const blockHeight =
        p.textAscent() + p.textDescent() + (lines - 1) * p.textLeading();
      const y = p.height / 2 - blockHeight / 2 + p.textAscent();
      p.text(text, lineX, y);

      p.noLoop()
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
