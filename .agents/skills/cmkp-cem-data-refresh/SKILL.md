---
name: cmkp-cem-data-refresh
description: Sprawdza aktualność i bezpiecznie aktualizuje lokalne dane CMKP oraz CEM używane przez model progów rezydenckich w tym repozytorium. Używaj przy kontroli nowych sesji LEK/LDEK, odchyleń standardowych, wykazów miejsc, wyników postępowań oraz regenerowaniu datasetu i prognoz.
---

# Aktualizacja danych CMKP i CEM

Pracuj w repozytorium `proginaspecke.github.io`. Najpierw ustal, czy zadanie jest
tylko kontrolą aktualności, czy obejmuje również aktualizację plików. Kontrola
jest domyślnie tylko do odczytu. Aktualizuj źródła, gdy użytkownik o to prosi lub
gdy aktualizacja jest oczywistą częścią zleconego odświeżenia modelu.

## Kontrola lokalna

Uruchom:

```powershell
npm run prediction:audit
```

Skrypt sprawdza schematy CSV, pary LEK/LDEK, duplikaty, zakresy liczb, spójność
odchyleń standardowych, manifest CMKP, pobrane PDF-y oraz pokrycie rund w
`source_data`. Błędy blokują dalsze przetwarzanie. Ostrzeżenia oznaczają zwykle,
że dane jeszcze nie zostały opublikowane albo jeden etap lokalnego pipeline'u
pozostaje do wykonania.

## Kontrola internetu

Korzystaj wyłącznie z oficjalnych stron wymienionych w
[references/sources-and-schema.md](references/sources-and-schema.md). Porównaj
najnowszą sesję lub rundę dostępną online z raportem audytu lokalnego. Zapisz
osobno stan każdego rodzaju danych: komunikat egzaminacyjny, szczegółowe
statystyki z SD, wykaz miejsc i lista zakwalifikowanych.

Nie uznawaj całego datasetu za nieaktualny tylko dlatego, że jeden późniejszy
artefakt nie został jeszcze opublikowany. Na przykład komunikat z wynikiem
egzaminu może być dostępny wcześniej niż tabela z odchyleniem standardowym, a
wykaz miejsc wcześniej niż wyniki kwalifikacji.

Jeżeli użytkownik prosi tylko o sprawdzenie, podaj:

- najnowszy lokalny i internetowy okres dla każdego źródła,
- brakujące artefakty i ich oficjalne adresy,
- etapy pipeline'u wymagane po ich publikacji,
- datę wykonania kontroli.

## Aktualizacja

Przed zmianą przeczytaj odpowiednią sekcję schematu źródeł. Zachowaj surowe
źródło oraz dokładny URL. Nie przepisuj wartości z blogów, agregatorów ani
wyników wyszukiwarki, jeżeli oficjalna tabela lub dokument jest dostępny.

1. Dodaj lub popraw tylko surowe źródła:
   - wyniki sesji LEK/LDEK w
     `prediction/sources/cem_lek_ldek_wyniki_2023w_2026j.csv`;
   - SD w `prediction/sources/cem_exam_standard_deviation.csv`;
   - adres wykazu miejsc w `prediction/sources/cmkp_places_manifest.json`, po
     czym uruchom `npm run prediction:download-places` i
     `python scripts/parse_cmkp_places.py` przy użyciu dostępnego interpretera;
   - sparsowane listy wynikowe w `source_data/<runda>_parsed.csv`, generowane
     przez `cmkp_wyniki_parse/` zgodnie z instrukcjami tego podprojektu.
2. Uruchom ponownie `npm run prediction:audit`.
3. Po zmianie danych CEM lub wyników uruchom kolejno:

   ```powershell
   npm run prediction:data
   npm run prediction:scope
   npm run prediction:model
   ```

4. Porównaj raport modelu przed i po zmianie. Zachowaj walidację rolling-origin.
   Nie wybieraj nowego wariantu produkcyjnego, jeżeli jest gorszy od zachowanego
   baseline'u na zadeklarowanej metryce. Sprawdź, że prawdopodobieństwa modelu
   wypełnienia są skończone i należą do `[0, 1]`.
5. Uruchom `npm run typecheck` i `npm run build`.

Pliki generowane w `prediction/data/` zawsze odtwarzaj skryptami. Nie poprawiaj
ich ręcznie. Nie łącz niepełnej puli z konkurencyjnym progiem. Zachowaj osobne
ścieżki LEK i LDEK oraz obecne wyłączenie specjalizacji mieszanych.

## Raport końcowy

Wymień pozyskane okresy i źródła, zmienione pliki, wyniki audytu, uruchomione
etapy pipeline'u oraz wpływ na metryki modeli. Jeśli oficjalne dane są częściowe,
nazwij dokładnie brakującą publikację zamiast uzupełniać ją szacunkiem.
