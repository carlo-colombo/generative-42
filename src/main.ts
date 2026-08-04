import p5 from "p5";
import { createSketch, downloadImage } from "./sketch";
import { DRAWS } from "./draws";
import { DEFAULT_GENERATION } from "./types";
import type { Generation } from "./types";
import "./style.css";

function getGenerationFromURL(): Generation {
  const params = new URLSearchParams(window.location.search);
  return {
    seed: parseInt(params.get("seed") ?? String(DEFAULT_GENERATION.seed)),
    image: params.get("image") ?? DEFAULT_GENERATION.image,
    draw: params.get("draw") ?? DEFAULT_GENERATION.draw,
    text: params.get("text") ?? DEFAULT_GENERATION.text,
  };
}

function getGeneration(): Generation {
  if (window.location.search) {
    return getGenerationFromURL();
  }

  const stored = localStorage.getItem("generation");
  if (stored) {
    try {
      return { ...DEFAULT_GENERATION, ...JSON.parse(stored) };
    } catch {}
  }

  return DEFAULT_GENERATION;
}

function applyGeneration(gen: Generation) {
  localStorage.setItem("generation", JSON.stringify(gen));
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(gen.seed));
  url.searchParams.set("image", gen.image);
  url.searchParams.set("draw", gen.draw);
  url.searchParams.set("text", gen.text);
  window.location.href = url.toString();
}

function createUI(gen: Generation) {
  const panel = document.createElement("div");
  panel.id = "panel";

  const header = document.createElement("h1");
  header.textContent = "Generative 42";
  panel.appendChild(header);

  const imageLabel = document.createElement("label");
  imageLabel.textContent = "Image";
  imageLabel.htmlFor = "image-select";
  const imageSelect = document.createElement("select");
  imageSelect.id = "image-select";
  imageSelect.name = "image";

  const drawLabel = document.createElement("label");
  drawLabel.textContent = "Draw function";
  drawLabel.htmlFor = "draw-select";
  const drawSelect = document.createElement("select");
  drawSelect.id = "draw-select";
  drawSelect.name = "draw";
  for (const name of Object.keys(DRAWS)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    drawSelect.appendChild(opt);
  }
  drawSelect.value = gen.draw;

  const textLabel = document.createElement("label");
  textLabel.textContent = "Text";
  textLabel.htmlFor = "text-input";
  const textInput = document.createElement("textarea");
  textInput.id = "text-input";
  textInput.name = "text";
  textInput.rows = 4;
  textInput.value = gen.text;
  textInput.addEventListener("input", () => {
    textInput.value = textInput.value.toUpperCase();
  });

  const seedRow = document.createElement("div");
  seedRow.className = "seed-row";
  const seedDisplay = document.createElement("span");
  seedDisplay.textContent = `Seed: ${gen.seed}`;
  const nextSeed = document.createElement("button");
  nextSeed.textContent = "Next seed";
  nextSeed.onclick = () => {
    gen.seed++;
    applyGeneration(gen);
  };
  seedRow.append(seedDisplay, nextSeed);

  const generate = document.createElement("button");
  generate.textContent = "Generate";
  generate.className = "primary";
  generate.onclick = () => {
    gen.image = imageSelect.value;
    gen.draw = drawSelect.value;
    gen.text = textInput.value.toUpperCase();
    applyGeneration(gen);
  };

  const download = document.createElement("button");
  download.textContent = "Download PNG";
  download.onclick = () => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    downloadImage(canvas, `gen-${gen.seed}.png`);
  };

  panel.append(
    imageLabel,
    imageSelect,
    drawLabel,
    drawSelect,
    textLabel,
    textInput,
    seedRow,
    generate,
    download
  );
  document.body.insertBefore(panel, app);

  fetch("/assets/manifest.json")
    .then((r) => r.json())
    .then((files: string[]) => {
      imageSelect.innerHTML = "";
      for (const f of files) {
        const opt = document.createElement("option");
        opt.value = `/assets/${f}`;
        opt.textContent = f;
        imageSelect.appendChild(opt);
      }
      imageSelect.value = gen.image;
    })
    .catch(() => {
      const opt = document.createElement("option");
      opt.value = DEFAULT_GENERATION.image;
      opt.textContent = DEFAULT_GENERATION.image;
      imageSelect.appendChild(opt);
    });
}

const gen = getGeneration();
const app = document.getElementById("app")!;
const instance = new p5(createSketch(gen), app);
createUI(gen);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance.remove();
  });
}
