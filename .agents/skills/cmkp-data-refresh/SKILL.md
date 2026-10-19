---
name: cmkp-data-refresh
description: Sprawdza aktualność i bezpiecznie aktualizuje dane CMKP używane przez stronę progów specjalizacyjnych (wykazy miejsc i listy zakwalifikowanych). Używaj przy pytaniach o nową rundę rekrutacji, brakujące dane, ponowne parsowanie PDF-ów CMKP lub kontrolę spójności source_data.
---

# Aktualizacja danych CMKP

Pracuj w repozytorium `proginaspecke.github.io`. Pełny opis pipeline'u jest w
`data_pipeline/README.md` – przeczytaj go przed zmianą plików. Najpierw ustal,
czy zadanie jest tylko kontrolą aktualności (domyślnie: tylko odczyt), czy
obejmuje aktualizację plików.

Strona korzysta z dwóch rodzajów danych, śledź je niezależnie:

1. **Wykaz miejsc CMKP** -> `source_data/cmkp_places.csv`
   (źródła: `data_pipeline/places/`).
2. **Lista zakwalifikowanych CMKP** -> `source_data/<runda>_parsed.csv`
   (źródła: `data_pipeline/results/`).

Runda ma identyfikator `w-RRRR` (wiosna) albo `j-RRRR` (jesień). Wykaz miejsc
pojawia się wcześniej niż wyniki – brak wyników dla rundy z wykazem miejsc jest
poprawnym stanem przejściowym, nie błędem.

## Kontrola lokalna

```powershell
npm run data:audit
```

Audyt sprawdza manifest wykazów miejsc, pobrane PDF-y, sparsowane miejsca,
pokrycie rund w `source_data` oraz zgodność PDF-ów wyników z CSV. Błędy blokują
dalsze przetwarzanie; ostrzeżenia zwykle oznaczają niepublikowane jeszcze dane.

## Kontrola internetu

Korzystaj wyłącznie z oficjalnej strony
https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne (podstrony
poszczególnych postępowań). Nie przepisuj wartości z blogów, agregatorów ani
wyników wyszukiwarki. Jeżeli użytkownik prosi tylko o sprawdzenie, podaj:

- najnowszą lokalną i opublikowaną rundę dla każdego z dwóch źródeł,
- brakujące dokumenty z bezpośrednimi URL-ami PDF,
- kroki pipeline'u potrzebne po ich pobraniu,
- datę kontroli.

## Aktualizacja

1. Wykaz miejsc: dopisz `{ "rekrutacja": "<runda>", "url": "<bezpośredni PDF CMKP>" }`
   do `data_pipeline/places/cmkp_places_manifest.json`, potem
   `npm run data:download-places` i `npm run data:parse-places`. Sprawdź, że
   w `data_pipeline/places/cmkp_places_quality_report.json` `low_confidence_matches`
   i `duplicate_keys` wynoszą 0.
2. Wyniki: zapisz PDF „Lista lekarzy zakwalifikowanych…” jako
   `data_pipeline/results/pdfs/<runda>.pdf` i uruchom `npm run data:parse-results`.
   Przed zmianą samego parsera przeczytaj `data_pipeline/results/AGENTS.md`.
   `git diff source_data` powinien pokazać tylko nową rundę.
3. Uruchom ponownie `npm run data:audit`, potem `npm run typecheck` i `npm run build`.

Do parserów potrzebny jest Python z `pdfplumber`. Pliki w `source_data/` są
generowane – nie poprawiaj ich ręcznie. Nie traktuj najniższego wyniku w
niepełnie obsadzonej puli jako konkurencyjnego progu.

Dane CEM (LEK/LDEK, SD) i model prognoz zostały zarchiwizowane w
`archive/prediction/` i nie są częścią tej procedury.

## Raport końcowy

Wymień sprawdzone i pobrane rundy ze źródłami, zmienione pliki, wynik audytu
oraz wynik `typecheck`/`build`. Jeśli dane są częściowe, nazwij brakującą
publikację zamiast ją szacować.
