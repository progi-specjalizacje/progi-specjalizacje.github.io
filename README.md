# Progi na specjalizacje

Kod strony [progi-specjalizacje.pl](https://progi-specjalizacje.pl) – porównanie progów punktowych,
liczby miejsc i wyników rekrutacji na specjalizacje lekarskie i lekarsko-dentystyczne (CMKP)
według województw i naborów. Aplikacja React + TypeScript (Vite) działa wyłącznie w przeglądarce,
bez backendu; dane są statycznymi plikami JSON generowanymi z CSV przy buildzie.

Agenci AI (Codex, Claude Code) zaczynają od [`AGENTS.md`](AGENTS.md).

## Co jest gdzie

```text
.
├── src/              # aplikacja React (komponenty, konfiguracja układu, stan, style)
├── scripts/          # skrypty builda: preprocess.js (CSV -> JSON), generateHomepageSeo.js
├── source_data/      # dane strony: <runda>_parsed.csv (wyniki) + cmkp_places.csv (miejsca)
├── data_pipeline/    # pobieranie i parsowanie PDF-ów CMKP do source_data/ + audyt danych
├── public/           # pliki statyczne; public/data/*.json generuje preprocess.js
├── index.html        # szablon strony; blok SEO wypełnia generateHomepageSeo.js
├── archive/          # rzeczy wycofane (model prognoz, podstrony SEO, runda j-2022)
├── .agents/skills/   # projektowe skille agentów (cmkp-data-refresh)
├── .claude/          # konfiguracja podglądu dev servera dla Claude Code
└── .github/workflows # deploy na GitHub Pages
```

## Uruchomienie lokalne

```bash
npm install
npm run dev
```

Strona: `http://127.0.0.1:5173/`. `npm run dev` i `npm run build` najpierw uruchamiają
`scripts/preprocess.js` i `scripts/generateHomepageSeo.js`.

| Polecenie | Co robi |
| --- | --- |
| `npm run dev` | preprocess + SEO + serwer Vite |
| `npm run build` | preprocess + SEO + `tsc` + build do `dist/` |
| `npm run typecheck` | kontrola typów |
| `npm run preview` | podgląd zbudowanego `dist/` |
| `npm run data:audit` | lokalny audyt danych w `source_data/` i `data_pipeline/` |
| `npm run data:download-places` | pobranie PDF-ów wykazu miejsc CMKP z manifestu |
| `npm run data:parse-places` | PDF-y miejsc -> `source_data/cmkp_places.csv` |
| `npm run data:parse-results` | PDF-y list zakwalifikowanych -> `source_data/<runda>_parsed.csv` |

Parsery wymagają Pythona z `pdfplumber` (`python -m pip install pdfplumber`).

## Przepływ danych

```text
PDF-y CMKP ──data_pipeline/──▶ source_data/*.csv ──scripts/preprocess.js──▶ public/data/*.json
                                                                        └─▶ src/data/reportMetadata.ts
public/data/*.json ──scripts/generateHomepageSeo.js──▶ index.html (blok SEO) + public/sitemap.xml
public/data/*.json ──fetch w src/data/reportData.ts──▶ komponenty
```

Dodanie nowej rundy rekrutacji jest opisane krok po kroku w
[`data_pipeline/README.md`](data_pipeline/README.md). Agent może to zrobić skillem
[`$cmkp-data-refresh`](.agents/skills/cmkp-data-refresh/SKILL.md):

> Użyj `$cmkp-data-refresh`, sprawdź, czy CMKP opublikowało nowe dane, i zaktualizuj stronę.

## Dane źródłowe

`source_data/[wj]-RRRR_parsed.csv` – jedna runda na plik (`w` = wiosna, `j` = jesień), np.
`w-2026_parsed.csv`. Najważniejsze kolumny: `rekrutacja`, `wojewodztwo`, `dziedzina_medycyny`,
`tryb_szkolenia`, `punktacja_proc`, `ilość_zakwalifikowanych_w_trybie`. Pełny opis kolumn:
[`data_pipeline/results/README.md`](data_pipeline/results/README.md).

`source_data/cmkp_places.csv` – liczba miejsc szkoleniowych (rezydenckich i pozarezydenckich)
według rundy, województwa i dziedziny. Strona używa jej, żeby odróżnić konkurencyjny próg od
najniższego wyniku w niepełnie obsadzonej puli.

## Układ strony

Układ i wybór wizualizacji są w `src/config/dashboardLayout.ts` (pozycje w siatce CSS, KPI,
konfiguracja tabeli przestawnej). Zmiany układu rób tam, nie w komponentach.

Lista specjalizacji w wyszukiwarce może być ograniczona flagą `LIMIT_SPECIALTY_SEARCH` w
`src/config/specialtySearchFilter.ts` (obecnie `false` – pełna lista).

## Deploy (GitHub Pages)

Workflow `.github/workflows/deploy.yml` buduje stronę i publikuje ją przy każdym pushu do `main`
(albo ręcznie z zakładki **Actions**). W **Settings -> Pages** źródłem musi być **GitHub Actions**.

Domena jest zapisana w `public/CNAME` (kopiowana do `dist/CNAME`). DNS dla
`progi-specjalizacje.pl` (rejestrator above.com):

- rekordy A dla `@`: `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`,
- `www` CNAME: `progi-specjalizacje.github.io`.

Usuń sprzeczne stare rekordy A/AAAA/CNAME dla tych nazw. Po weryfikacji domeny przez GitHub włącz
**Enforce HTTPS** w **Settings -> Pages**.

## Archiwum

[`archive/`](archive/README.md) zawiera wycofany model prognoz progów i zapełnienia (z danymi
CEM LEK/LDEK), dawne podstrony SEO specjalizacji oraz niepublikowaną rundę j-2022. Nic z tego
nie wchodzi do builda.
