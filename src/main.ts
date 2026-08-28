import p5 from "p5";
import { createSketch, downloadImage } from "./sketch";
import { DRAWS } from "./draws";
import { FONTS, DEFAULT_FONT } from "./fonts";
import { DEFAULT_GENERATION } from "./types";
import type { Generation } from "./types";
import "./style.css";

function numberOrDefault(value: string, fallback: number) {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

function getGenerationFromURL(): Generation {
  const params = new URLSearchParams(window.location.search);
  return {
    seed: parseInt(params.get("seed") ?? String(DEFAULT_GENERATION.seed)),
    image: params.get("image") ?? DEFAULT_GENERATION.image,
    draw: params.get("draw") ?? DEFAULT_GENERATION.draw,
    text: params.get("text") ?? DEFAULT_GENERATION.text,
    textAlign:
      (params.get("textAlign") as Generation["textAlign"]) ??
      DEFAULT_GENERATION.textAlign,
    textVAlign:
      (params.get("textVAlign") as Generation["textVAlign"]) ??
      DEFAULT_GENERATION.textVAlign,
    textX: parseInt(params.get("textX") ?? String(DEFAULT_GENERATION.textX)),
    textY: parseInt(params.get("textY") ?? String(DEFAULT_GENERATION.textY)),
    textSize: parseInt(
      params.get("textSize") ?? String(DEFAULT_GENERATION.textSize)
    ),
    font: params.get("font") ?? DEFAULT_GENERATION.font,
    textOpacity: parseInt(
      params.get("textOpacity") ?? String(DEFAULT_GENERATION.textOpacity)
    ),
    text2: params.get("text2") ?? DEFAULT_GENERATION.text2,
    text2Align:
      (params.get("text2Align") as Generation["textAlign"]) ??
      DEFAULT_GENERATION.text2Align,
    text2VAlign:
      (params.get("text2VAlign") as Generation["textVAlign"]) ??
      DEFAULT_GENERATION.text2VAlign,
    text2X: parseInt(params.get("text2X") ?? String(DEFAULT_GENERATION.text2X)),
    text2Y: parseInt(params.get("text2Y") ?? String(DEFAULT_GENERATION.text2Y)),
    text2Size: parseInt(
      params.get("text2Size") ?? String(DEFAULT_GENERATION.text2Size)
    ),
    text2Font: params.get("text2Font") ?? DEFAULT_GENERATION.text2Font,
    text2Opacity: parseInt(
      params.get("text2Opacity") ?? String(DEFAULT_GENERATION.text2Opacity)
    ),
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
  url.searchParams.set("textAlign", gen.textAlign);
  url.searchParams.set("textVAlign", gen.textVAlign);
  url.searchParams.set("textX", String(gen.textX));
  url.searchParams.set("textY", String(gen.textY));
  url.searchParams.set("textSize", String(gen.textSize));
  url.searchParams.set("font", gen.font);
  url.searchParams.set("textOpacity", String(gen.textOpacity));
  url.searchParams.set("text2", gen.text2);
  url.searchParams.set("text2Align", gen.text2Align);
  url.searchParams.set("text2VAlign", gen.text2VAlign);
  url.searchParams.set("text2X", String(gen.text2X));
  url.searchParams.set("text2Y", String(gen.text2Y));
  url.searchParams.set("text2Size", String(gen.text2Size));
  url.searchParams.set("text2Font", gen.text2Font);
  url.searchParams.set("text2Opacity", String(gen.text2Opacity));
  window.location.href = url.toString();
}

function createTextControls(
  panel: HTMLElement,
  gen: Generation,
  number: 1 | 2
) {
  const key = number === 1 ? "text" : "text2";
  const section = document.createElement("section");
  section.className = "text-control-group";
  const title = document.createElement("h2");
  title.textContent = `Text ${number}`;
  section.appendChild(title);

  const textLabel = document.createElement("label");
  textLabel.textContent = "Content";
  const textInput = document.createElement("textarea");
  textInput.rows = 4;
  textInput.value = gen[key];
  textInput.addEventListener("input", () => {
    textInput.value = textInput.value.toUpperCase();
  });
  textLabel.htmlFor = `${key}-input`;
  textInput.id = `${key}-input`;

  const alignLabel = document.createElement("label");
  alignLabel.textContent = "Alignment";
  const alignSelect = document.createElement("select");
  for (const value of ["left", "center", "right"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    alignSelect.appendChild(option);
  }
  alignLabel.htmlFor = `${key}-align`;
  alignSelect.id = `${key}-align`;
  alignSelect.value = number === 1 ? gen.textAlign : gen.text2Align;

  const valignLabel = document.createElement("label");
  valignLabel.textContent = "Vertical alignment";
  const valignSelect = document.createElement("select");
  for (const value of ["top", "center", "bottom"] as const) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    valignSelect.appendChild(option);
  }
  valignLabel.htmlFor = `${key}-valign`;
  valignSelect.id = `${key}-valign`;
  valignSelect.value = number === 1 ? gen.textVAlign : gen.text2VAlign;

  const xLabel = document.createElement("label");
  xLabel.textContent = "Horizontal position (%)";
  const xInput = document.createElement("input");
  xInput.type = "number";
  xInput.min = "0";
  xInput.max = "100";
  xInput.value = String(number === 1 ? gen.textX : gen.text2X);
  xLabel.htmlFor = `${key}-x`;
  xInput.id = `${key}-x`;

  const yLabel = document.createElement("label");
  yLabel.textContent = "Vertical position (%)";
  const yInput = document.createElement("input");
  yInput.type = "number";
  yInput.min = "0";
  yInput.max = "100";
  yInput.value = String(number === 1 ? gen.textY : gen.text2Y);
  yLabel.htmlFor = `${key}-y`;
  yInput.id = `${key}-y`;

  alignSelect.addEventListener("change", () => {
    xInput.value = alignSelect.value === "left"
      ? "5"
      : alignSelect.value === "right"
        ? "95"
        : "50";
  });
  valignSelect.addEventListener("change", () => {
    yInput.value = valignSelect.value === "top"
      ? "5"
      : valignSelect.value === "bottom"
        ? "95"
        : "50";
  });

  const sizeLabel = document.createElement("label");
  sizeLabel.textContent = "Font size";
  const sizeInput = document.createElement("input");
  sizeInput.type = "number";
  sizeInput.min = "10";
  sizeInput.max = "3000";
  sizeInput.step = "5";
  sizeInput.value = String(number === 1 ? gen.textSize : gen.text2Size);
  sizeLabel.htmlFor = `${key}-size`;
  sizeInput.id = `${key}-size`;

  const fontLabel = document.createElement("label");
  fontLabel.textContent = "Font";
  const fontSelect = document.createElement("select");
  for (const font of FONTS) {
    const option = document.createElement("option");
    option.value = font.path;
    option.textContent = font.label;
    fontSelect.appendChild(option);
  }
  fontLabel.htmlFor = `${key}-font`;
  fontSelect.id = `${key}-font`;
  const selectedFont = number === 1 ? gen.font : gen.text2Font;
  fontSelect.value = FONTS.some((font) => font.path === selectedFont)
    ? selectedFont
    : DEFAULT_FONT;

  const opacityLabel = document.createElement("label");
  opacityLabel.textContent = "Opacity";
  const opacityRow = document.createElement("div");
  opacityRow.className = "slider-row";
  const opacityInput = document.createElement("input");
  opacityInput.type = "range";
  opacityInput.min = "0";
  opacityInput.max = "100";
  opacityInput.value = String(number === 1 ? gen.textOpacity : gen.text2Opacity);
  const opacityValue = document.createElement("span");
  opacityValue.textContent = `${opacityInput.value}%`;
  opacityInput.addEventListener("input", () => {
    opacityValue.textContent = `${opacityInput.value}%`;
  });
  opacityRow.append(opacityInput, opacityValue);
  opacityLabel.htmlFor = `${key}-opacity`;
  opacityInput.id = `${key}-opacity`;

  const fields = [
    [textLabel, textInput],
    [alignLabel, alignSelect],
    [valignLabel, valignSelect],
    [xLabel, xInput],
    [yLabel, yInput],
    [sizeLabel, sizeInput],
    [fontLabel, fontSelect],
    [opacityLabel, opacityRow],
  ];
  for (const [label, control] of fields) {
    const field = document.createElement("div");
    field.className = "control-field";
    field.append(label, control);
    section.appendChild(field);
  }
  panel.appendChild(section);

  return { textInput, alignSelect, valignSelect, xInput, yInput, sizeInput, fontSelect, opacityInput };
}

function createUI(gen: Generation) {
  const panel = document.createElement("div");
  panel.id = "panel";

  const header = document.createElement("h1");
  header.textContent = "Generative 42";
  panel.appendChild(header);

  const sourceControls = document.createElement("div");
  sourceControls.className = "source-controls";

  const imageField = document.createElement("div");
  imageField.className = "control-field";
  const imageLabel = document.createElement("label");
  imageLabel.textContent = "Image";
  imageLabel.htmlFor = "image-select";
  const imageSelect = document.createElement("select");
  imageSelect.id = "image-select";
  imageSelect.name = "image";

  imageField.append(imageLabel, imageSelect);

  const drawField = document.createElement("div");
  drawField.className = "control-field";
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
  drawField.append(drawLabel, drawSelect);
  sourceControls.append(imageField, drawField);

  const textControls = document.createElement("div");
  textControls.className = "text-controls";
  const text1 = createTextControls(textControls, gen, 1);
  const text2 = createTextControls(textControls, gen, 2);

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

  const actions = document.createElement("div");
  actions.className = "actions";

  const generate = document.createElement("button");
  generate.textContent = "Generate";
  generate.className = "primary";
  generate.onclick = () => {
    gen.image = imageSelect.value;
    gen.draw = drawSelect.value;
    gen.text = text1.textInput.value.toUpperCase();
    gen.textAlign = text1.alignSelect.value as Generation["textAlign"];
    gen.textVAlign = text1.valignSelect.value as Generation["textVAlign"];
    gen.textX = numberOrDefault(text1.xInput.value, DEFAULT_GENERATION.textX);
    gen.textY = numberOrDefault(text1.yInput.value, DEFAULT_GENERATION.textY);
    gen.textSize = numberOrDefault(text1.sizeInput.value, DEFAULT_GENERATION.textSize);
    gen.font = text1.fontSelect.value;
    gen.textOpacity = numberOrDefault(text1.opacityInput.value, DEFAULT_GENERATION.textOpacity);
    gen.text2 = text2.textInput.value.toUpperCase();
    gen.text2Align = text2.alignSelect.value as Generation["textAlign"];
    gen.text2VAlign = text2.valignSelect.value as Generation["textVAlign"];
    gen.text2X = numberOrDefault(text2.xInput.value, DEFAULT_GENERATION.text2X);
    gen.text2Y = numberOrDefault(text2.yInput.value, DEFAULT_GENERATION.text2Y);
    gen.text2Size = numberOrDefault(text2.sizeInput.value, DEFAULT_GENERATION.text2Size);
    gen.text2Font = text2.fontSelect.value;
    gen.text2Opacity = numberOrDefault(text2.opacityInput.value, DEFAULT_GENERATION.text2Opacity);
    applyGeneration(gen);
  };

  imageSelect.addEventListener("change", () => generate.click());
  drawSelect.addEventListener("change", () => generate.click());

  const download = document.createElement("button");
  download.textContent = "Download PNG";
  download.onclick = () => {
    const canvas = document.querySelector("canvas") as HTMLCanvasElement;
    const imageName = gen.image.split("/").pop()?.replace(/\.[^.]+$/, "") ?? "image";
    downloadImage(canvas, `gen-${gen.seed}-${gen.draw}-${imageName}.png`);
  };
  actions.append(seedRow, generate, download);

  panel.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const target = e.target as HTMLElement;
    const isField =
      target.tagName === "INPUT" ||
      target.tagName === "TEXTAREA" ||
      target.tagName === "SELECT";
    if (isField) {
      e.preventDefault();
      generate.click();
    }
  });

  panel.append(
    sourceControls,
    textControls,
    actions
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
