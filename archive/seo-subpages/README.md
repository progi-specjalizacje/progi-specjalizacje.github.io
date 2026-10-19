# Archiwum: statyczne podstrony specjalizacji

Wycofane w październiku 2026. Podstrony `/specjalizacje/` i `/specjalizacje/<slug>/` nie zostały
zaindeksowane przez Google („Discovered – currently not indexed”) i były szablonowe, więc
SEO skupia się teraz na stronie głównej. Ten katalog nie jest częścią builda ani deployu.

- `generateSeoPages.js` – ostatnia wersja generatora (podstrony, katalog, sitemapa, treść strony głównej).
  Ścieżki są względne wobec dawnej lokalizacji `scripts/`, więc nie uruchamia się stąd bez zmian.
- `seo-pages.css` – style podstron (dawniej `public/seo-pages.css`).
- `generated-pages/` – ostatnio wygenerowane HTML podstron (migawka).
- `sitemap-specializacje.xml` – ostatnia sitemapa podstron.

Treść SEO strony głównej (tabela progów, FAQ, `<title>`, `sitemap.xml`) generuje teraz
`scripts/generateHomepageSeo.js`.

Aby przywrócić podstrony: przenieś generator z powrotem do `scripts/`, CSS do `public/`, dodaj
skrypt do `package.json` i ponownie dodaj adresy do `public/robots.txt` / sitemapy.
