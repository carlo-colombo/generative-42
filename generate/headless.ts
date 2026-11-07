import puppeteer, { type Browser } from "puppeteer";
import { execSync } from "child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { extname, resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { preview, type PreviewServer } from "vite";
import { DEFAULT_GENERATION, type Generation } from "../src/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const OUTPUT_DIR = resolve(ROOT, "output");
const PORT = 4173;

function getGenerations(): Generation[] {
  const args = process.argv.slice(2);

  if (args.includes("--all")) {
    const gens: Generation[] = [];
    for (let seed = 1; seed <= 10; seed++) {
      gens.push({ ...DEFAULT_GENERATION, seed });
    }
    return gens;
  }

  const seedArg = args.find((a) => a.startsWith("--seed="));
  const seed = seedArg ? parseInt(seedArg.split("=")[1]) : 1;

  return [{ ...DEFAULT_GENERATION, seed }];
}

// The repository ships no images, so a source has to come from --image= or
// from a deployment-provided set listed by the build artifact.
function sourceImageFile(): string {
  const arg = process.argv.slice(2).find((a) => a.startsWith("--image="));
  if (arg) {
    const file = resolve(ROOT, arg.slice("--image=".length));
    if (!existsSync(file)) throw new Error(`Source image not found: ${file}`);
    return file;
  }
  const assetsDir = resolve(ROOT, "dist/assets");
  const manifestPath = resolve(assetsDir, "manifest.json");
  if (existsSync(manifestPath)) {
    const files = JSON.parse(readFileSync(manifestPath, "utf8")) as string[];
    if (files.length > 0) return resolve(assetsDir, files[0]);
  }
  throw new Error("No source image: pass --image=<path> (the repository ships none)");
}

function stageSourceImage(file: string): string {
  const name = `generate-input${extname(file)}`;
  cpSync(file, resolve(ROOT, "dist/assets", name));
  return `/assets/${name}`;
}

function startPreviewServer(): Promise<PreviewServer> {
  return preview({
    root: ROOT,
    preview: { port: PORT, strictPort: true, host: "localhost" },
  });
}

async function renderGeneration(
  browser: Browser,
  gen: Generation,
  imageRef: string
): Promise<Buffer> {
  const page = await browser.newPage();

  // A fresh Puppeteer profile would otherwise install a worker mid-capture.
  const query = new URLSearchParams({ seed: String(gen.seed), image: imageRef, sw: "0" });
  const url = `http://localhost:${PORT}/?${query.toString()}`;
  await page.goto(url, { waitUntil: "networkidle0" });

  await page.waitForFunction(
    (seed) => {
      const canvas = document.querySelector<HTMLCanvasElement>("canvas.base-layer");
      return canvas !== null && canvas.dataset.composed === String(seed);
    },
    {},
    gen.seed
  );

  const dataUrl = await page.evaluate(() => {
    const canvas = document.querySelector("canvas.base-layer") as HTMLCanvasElement;
    return canvas.toDataURL("image/png");
  });

  await page.close();

  const base64 = dataUrl.split(",")[1];
  return Buffer.from(base64, "base64");
}

async function main() {
  const generations = getGenerations();

  console.log("Building project...");
  execSync("pnpm run build", { cwd: ROOT, stdio: "inherit" });
  const sourceFile = sourceImageFile();
  const imageRef = stageSourceImage(sourceFile);
  console.log(`Source image: ${sourceFile}`);

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log("Starting preview server...");
  const server = await startPreviewServer();

  let browser: Browser | undefined;
  try {
    browser = await puppeteer.launch({ headless: true });
    for (const gen of generations) {
      console.log(`Rendering seed ${gen.seed}...`);
      const buffer = await renderGeneration(browser, gen, imageRef);
      const outPath = resolve(OUTPUT_DIR, `gen-${gen.seed}.png`);
      writeFileSync(outPath, buffer);
      console.log(`  Saved: ${outPath}`);
    }
  } finally {
    await browser?.close();
    await server.close();
  }
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
