import puppeteer, { type Browser } from "puppeteer";
import { execSync } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
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

function startPreviewServer(): Promise<PreviewServer> {
  return preview({
    root: ROOT,
    preview: { port: PORT, strictPort: true, host: "localhost" },
  });
}

async function renderGeneration(
  browser: Browser,
  gen: Generation
): Promise<Buffer> {
  const page = await browser.newPage();

  const url = `http://localhost:${PORT}?seed=${gen.seed}`;
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
      const buffer = await renderGeneration(browser, gen);
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
