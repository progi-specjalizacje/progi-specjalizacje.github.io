# Pipeline danych strony

Wszystko, co jest potrzebne, żeby pobrać i przetworzyć oficjalne publikacje CMKP do plików,
z których korzysta strona. Wynik zawsze ląduje w `source_data/` (katalog główny repo);
stamtąd `scripts/preprocess.js` buduje `public/data/*.json` przy `npm run dev` / `npm run build`.

```text
data_pipeline/
├── audit.mjs                     # lokalny audyt danych (bez internetu, tylko odczyt)
├── forecast/                     # zamrożona prognoza progów z archiwum -> source_data/forecast_<runda>.csv
│   └── export_forecast.mjs       # node data_pipeline/forecast/export_forecast.mjs [runda]
├── results/                      # listy zakwalifikowanych CMKP -> source_data/<runda>_parsed.csv
│   ├── parse_smk_ranking.py
│   ├── pdfs/<runda>.pdf
│   ├── README.md                 # opis kolumn i logiki parsera
│   └── AGENTS.md
└── places/                       # wykaz liczby miejsc CMKP -> source_data/cmkp_places.csv
    ├── cmkp_places_manifest.json # runda -> oficjalny URL PDF-u
    ├── download_cmkp_places.js
    ├── parse_cmkp_places.py
    ├── pdfs/<runda>.pdf
    └── cmkp_places_quality_report.json  # generowany przez parser
```

Identyfikator rundy: `w-RRRR` (wiosna) albo `j-RRRR` (jesień).

## Wymagania

- Node.js (jak dla całego projektu),
- Python 3.8+ z pakietem `pdfplumber`: `python -m pip install pdfplumber`.

## Nowa runda – krok po kroku

1. **Wykaz miejsc** (publikowany przed wynikami): dopisz rundę i bezpośredni URL PDF-u CMKP do
   `places/cmkp_places_manifest.json`, potem:

   ```bash
   npm run data:download-places
   npm run data:parse-places
   ```

   Sprawdź `places/cmkp_places_quality_report.json` – `low_confidence_matches` i
   `duplicate_keys` powinny wynosić 0.

2. **Lista zakwalifikowanych**: pobierz PDF „Lista lekarzy zakwalifikowanych…” ze strony
   [CMKP – postępowania kwalifikacyjne](https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne),
   zapisz jako `results/pdfs/<runda>.pdf`, potem:

   ```bash
   npm run data:parse-results
   ```

   Parser przetwarza wszystkie PDF-y i nadpisuje CSV w `source_data/`; dla istniejących rund
   wynik jest identyczny, więc `git diff source_data` powinien pokazać tylko nową rundę.

3. **Kontrola i build**:

   ```bash
   npm run data:audit
   npm run typecheck
   npm run build
   ```

   Brak listy wynikowej dla rundy, która ma już wykaz miejsc, jest raportowany jako ostrzeżenie
   (wyniki publikowane są później) – to poprawny stan przejściowy.

Projektowy skill [`cmkp-data-refresh`](../.agents/skills/cmkp-data-refresh/SKILL.md) prowadzi
agenta przez kontrolę aktualności online i tę samą procedurę.

## Zasady

- Pliki w `source_data/` i `places/cmkp_places_quality_report.json` są generowane – odtwarzaj je
  skryptami, nie poprawiaj ręcznie.
- Zachowuj surowe PDF-y i dokładne URL-e źródeł.
- `scripts/preprocess.js` czyta z `source_data/` tylko pliki `[wj]-RRRR_parsed.csv` jako wyniki
  oraz `cmkp_places.csv` jako liczbę miejsc.
- Najniższy wynik w niepełnie obsadzonej puli nie jest konkurencyjnym progiem; strona ustala
  status progu dopiero po połączeniu z liczbą miejsc.
