import p5 from "p5";
import { createSketch, downloadImage } from "./sketch";
import { DEFAULT_GENERATION } from "./types";
import type { Generation } from "./types";
import "./style.css";

function getGenerationFromURL(): Generation {
  const params = new URLSearchParams(window.location.search);
  return {
    seed: parseInt(params.get("seed") ?? String(DEFAULT_GENERATION.seed)),
  };
}

function getGeneration(): Generation {
  if (window.location.search) {
    return getGenerationFromURL();
  }

  const stored = localStorage.getItem("generation");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch {}
  }

  return DEFAULT_GENERATION;
}

function setupControls(gen: Generation) {
  const div = document.createElement("div");
  div.id = "controls";
  div.innerHTML = `
    <button id="download">Download PNG</button>
    <button id="next-seed">Next Seed</button>
    <span id="seed-display">Seed: ${gen.seed}</span>
  `;
  document.body.appendChild(div);

  div.style.cssText =
    "position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;gap:12px;align-items:center;z-index:100";

  document.getElementById("download")!.onclick = () => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    downloadImage(canvas, `gen-${gen.seed}.png`);
  };

  document.getElementById("next-seed")!.onclick = () => {
    gen.seed++;
    localStorage.setItem("generation", JSON.stringify(gen));
    const url = new URL(window.location.href);
    url.searchParams.set("seed", String(gen.seed));
    window.location.href = url.toString();
  };
}

const gen = getGeneration();
const instance = new p5(createSketch(gen));
setupControls(gen);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    instance.remove();
  });
}
