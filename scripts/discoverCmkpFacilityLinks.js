const pages = [
  ["w-2023", "postepowanie-kwalifikacyjne-wiosna-2023"],
  ["w-2024", "postepowanie-kwalifikacyjne-wiosna-2024"],
  ["j-2024", "postepowanie-kwalifikacyjne-jesien-2024"],
  ["w-2025", "postepowanie-kwalifikacyjne-wiosna-2025"],
  ["j-2025", "postepowanie-kwalifikacyjne-jesien-2025"],
];
const wanted = new Map([
  ["dolnoslaskie", "Dolnośląskie"],
  ["mazowieckie", "Mazowieckie"],
  ["warminskomazurskie", "Warmińsko-mazurskie"],
]);

const normalize = (value) => value
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .toLowerCase()
  .replace(/[^a-z]/g, "");
const decodeText = (value) => value
  .replace(/<[^>]+>/g, " ")
  .replace(/&nbsp;|&#160;/gi, " ")
  .replace(/&oacute;/gi, "ó")
  .replace(/&sacute;/gi, "ś")
  .replace(/&lstrok;/gi, "ł")
  .replace(/&ndash;|&mdash;/gi, "-")
  .replace(/&[^;]+;/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const found = [];
for (const [rekrutacja, pageSlug] of pages) {
  const pageUrl = `https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne/${pageSlug}`;
  const response = await fetch(pageUrl);
  if (!response.ok) {
    throw new Error(`${pageUrl}: HTTP ${response.status}`);
  }
  const html = await response.text();
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decodeText(match[2]);
    const province = wanted.get(normalize(label));
    if (!province) continue;
    found.push({ rekrutacja, wojewodztwo: province, url: new URL(match[1], pageUrl).href });
  }
}

console.log(JSON.stringify(found, null, 2));
