import puppeteer, { type Browser } from "puppeteer";
import { execSync, spawn } from "child_process";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
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

function startPreviewServer(): Promise<void> {
  return new Promise((res) => {
    const server = spawn("pnpm", ["run", "preview"], {
      cwd: ROOT,
      stdio: "ignore",
      shell: true,
    });

    const check = setInterval(() => {
      fetch(`http://localhost:${PORT}`)
        .then(() => {
          clearInterval(check);
          res();
        })
        .catch(() => {});
    }, 200);

    process.on("exit", () => server.kill());
  });
}

async function renderGeneration(
  browser: Browser,
  gen: Generation
): Promise<Buffer> {
  const page = await browser.newPage();

  const url = `http://localhost:${PORT}?seed=${gen.seed}`;
  await page.goto(url, { waitUntil: "networkidle0" });

  await page.waitForFunction(() => {
    const canvas = document.querySelector("canvas.base-layer");
    return canvas !== null;
  });

  await new Promise((r) => setTimeout(r, 500));

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
  await startPreviewServer();

  const browser = await puppeteer.launch({ headless: true });

  for (const gen of generations) {
    console.log(`Rendering seed ${gen.seed}...`);
    const buffer = await renderGeneration(browser, gen);
    const outPath = resolve(OUTPUT_DIR, `gen-${gen.seed}-${gen.draw}.png`);
    writeFileSync(outPath, buffer);
    console.log(`  Saved: ${outPath}`);
  }

  await browser.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
