import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..", "..");
const manifestPath = path.join(__dirname, "cmkp_places_manifest.json");
const outputDir = path.join(__dirname, "pdfs");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

fs.mkdirSync(outputDir, { recursive: true });

for (const source of manifest) {
  const outputPath = path.join(outputDir, `${source.rekrutacja}.pdf`);
  if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 10_000) {
    console.log(`Pomijam istniejący plik ${path.relative(root, outputPath)}.`);
    continue;
  }

  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Nie udało się pobrać ${source.url}: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.subarray(0, 4).toString("ascii") !== "%PDF") {
    throw new Error(`Pobrany plik dla ${source.rekrutacja} nie jest dokumentem PDF.`);
  }

  fs.writeFileSync(outputPath, bytes);
  console.log(`Pobrano ${source.rekrutacja}: ${bytes.length} bajtów.`);
}
