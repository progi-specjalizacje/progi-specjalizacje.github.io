import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(root, "prediction", "sources", "cmkp_facility_pilot_manifest.json");
const outputDir = path.join(root, "prediction", "sources", "cmkp_facility_pdfs");

const slug = (value) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
await mkdir(outputDir, { recursive: true });

for (const source of manifest) {
  const response = await fetch(source.url);
  if (!response.ok) {
    throw new Error(`Pobieranie ${source.url} zakończyło się HTTP ${response.status}.`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (!body.subarray(0, 4).equals(Buffer.from("%PDF"))) {
    throw new Error(`${source.url} nie zwrócił pliku PDF.`);
  }
  const fileName = `${source.rekrutacja}_${slug(source.wojewodztwo)}.pdf`;
  await writeFile(path.join(outputDir, fileName), body);
  const checksum = createHash("sha256").update(body).digest("hex");
  console.log(`${fileName}: ${body.length} B; sha256=${checksum}`);
}
