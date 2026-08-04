import p5 from "p5";

export interface Point {
  x: number;
  y: number;
}

export interface RGB {
  r: number;
  g: number;
  b: number;
}

interface ScaledImage {
  canvas: HTMLCanvasElement;
  scale: number;
  maxDim: number;
}

const scaledCache = new WeakMap<p5.Image, ScaledImage>();

function imageToCanvas(img: p5.Image): HTMLCanvasElement {
  return (img as unknown as { canvas: HTMLCanvasElement }).canvas;
}

function getScaled(img: p5.Image, maxDim: number): ScaledImage {
  const cached = scaledCache.get(img);
  if (cached && cached.maxDim === maxDim) return cached;

  const scale = Math.min(1, maxDim / Math.max(img.width, img.height));

  let entry: ScaledImage;
  if (scale === 1) {
    entry = { canvas: imageToCanvas(img), scale: 1, maxDim };
  } else {
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d")!.drawImage(imageToCanvas(img), 0, 0, w, h);
    entry = { canvas, scale, maxDim };
  }

  scaledCache.set(img, entry);
  return entry;
}

function averageRegion(
  canvas: HTMLCanvasElement,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): RGB {
  const left = Math.max(0, Math.floor(x0));
  const top = Math.max(0, Math.floor(y0));
  const right = Math.min(canvas.width - 1, Math.ceil(x1));
  const bottom = Math.min(canvas.height - 1, Math.ceil(y1));
  if (right < left || bottom < top) return { r: 0, g: 0, b: 0 };

  const w = right - left + 1;
  const h = bottom - top + 1;
  const data = canvas.getContext("2d")!.getImageData(left, top, w, h).data;

  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }

  const count = data.length / 4;
  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

function pointInPolygon(px: number, py: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;

    const intersect =
      yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function averagePolygon(canvas: HTMLCanvasElement, points: Point[]): RGB {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const pt of points) {
    minX = Math.min(minX, pt.x);
    minY = Math.min(minY, pt.y);
    maxX = Math.max(maxX, pt.x);
    maxY = Math.max(maxY, pt.y);
  }

  const left = Math.max(0, Math.floor(minX));
  const top = Math.max(0, Math.floor(minY));
  const right = Math.min(canvas.width - 1, Math.ceil(maxX));
  const bottom = Math.min(canvas.height - 1, Math.ceil(maxY));
  if (right < left || bottom < top) return { r: 0, g: 0, b: 0 };

  const w = right - left + 1;
  const h = bottom - top + 1;
  const data = canvas.getContext("2d")!.getImageData(left, top, w, h).data;

  let r = 0;
  let g = 0;
  let b = 0;
  let count = 0;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!pointInPolygon(left + x + 0.5, top + y + 0.5, points)) continue;

      const idx = (y * w + x) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count++;
    }
  }

  if (count === 0) return { r: 0, g: 0, b: 0 };

  return {
    r: Math.round(r / count),
    g: Math.round(g / count),
    b: Math.round(b / count),
  };
}

function isAxisAlignedRect(points: [Point, Point, Point, Point]): boolean {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  const combos = new Set(points.map((p) => `${p.x},${p.y}`));
  return (
    combos.size === 4 &&
    combos.has(`${minX},${minY}`) &&
    combos.has(`${maxX},${minY}`) &&
    combos.has(`${minX},${maxY}`) &&
    combos.has(`${maxX},${maxY}`)
  );
}

export function averageColorInArea(
  img: p5.Image,
  points: [Point, Point, Point, Point],
  maxDim = 100
): RGB {
  const { canvas, scale } = getScaled(img, maxDim);

  if (isAxisAlignedRect(points)) {
    const xs = points.map((p) => p.x * scale);
    const ys = points.map((p) => p.y * scale);
    return averageRegion(
      canvas,
      Math.min(...xs),
      Math.min(...ys),
      Math.max(...xs),
      Math.max(...ys)
    );
  }

  return averagePolygon(
    canvas,
    points.map((p) => ({ x: p.x * scale, y: p.y * scale }))
  );
}
