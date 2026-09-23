# Oficjalne źródła i schemat lokalny

## CEM: wyniki LEK i LDEK

- Archiwum/statystyki LEK: https://www.cem.edu.pl/lep_s_h.php oraz
  https://www.cem.edu.pl/lep_s.php
- Archiwum/statystyki LDEK: https://www.cem.edu.pl/ldep_s_h.php oraz
  https://www.cem.edu.pl/ldep_s.php
- Aktualności CEM: https://www.cem.edu.pl/

Plik `prediction/sources/cem_lek_ldek_wyniki_2023w_2026j.csv` ma dokładnie jeden
rekord na klucz `egzamin + rok + sesja`. Minimalne pola wymagane przez pipeline:

- `egzamin`: `LEK` albo `LDEK`;
- `rok` i `sesja`: rok oraz `wiosenna`/`jesienna`;
- `data_publikacji`: data oficjalnego komunikatu w ISO `RRRR-MM-DD`;
- `liczba_przystepujacych`, `srednia_pkt`, `min_pkt`, `max_pkt`;
- `liczba_ponizej_56_proc`, `max_mozliwych_pkt`;
- `liczba_uniewaznionych_zadan`, jeśli została podana lub wynika z liczby
  punktowanych zadań;
- `zrodlo`: bezpośredni oficjalny adres publikacji;
- `uwagi`: tylko wyjaśnienia niezbędne do interpretacji wartości.

Puste wartości pozostaw puste. Nie zapisuj zera jako zamiennika braku danych.

## CEM: odchylenie standardowe

Plik `prediction/sources/cem_exam_standard_deviation.csv` zawiera jeden rekord
na ten sam klucz. Pobieraj `odch. stand.`/`sd` z pierwszej tabeli zbiorczej i jej
wiersza `OGÓŁEM` albo `RAZEM`, obejmującego wszystkich przystępujących. Nie używaj
SD pojedynczej uczelni, absolwentów, studentów, zdających pierwszy raz ani osób
poprawiających wynik, chyba że model zostanie świadomie rozszerzony o osobne
cechy tych populacji.

`odchylenie_standardowe_pkt` jest wyrażone w punktach. Pipeline dzieli je przez
`max_mozliwych_pkt`, gdy potrzebuje wartości procentowej.

## CMKP: miejsca

- Archiwum postępowań kwalifikacyjnych:
  https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne

Każda nowa runda z oficjalnym wykazem miejsc wymaga rekordu w
`prediction/sources/cmkp_places_manifest.json`:

```json
{
  "rekrutacja": "w-2027",
  "url": "https://www.cmkp.edu.pl/...pdf"
}
```

Identyfikator rundy ma postać `w-RRRR` albo `j-RRRR`. URL musi wskazywać
bezpośrednio na oficjalny PDF. Po pobraniu parser zapisuje dane do
`prediction/data/cmkp_places.csv`; jest to plik generowany.

## CMKP: wyniki kwalifikacji

PDF-y list zakwalifikowanych przetwarza podprojekt `cmkp_wyniki_parse/`. Przed
uruchomieniem przeczytaj jego `AGENTS.md`. Docelowy plik ma nazwę
`source_data/<runda>_parsed.csv` i musi zachować kolumny oczekiwane przez
`scripts/buildPredictionDataset.js`.

Wynik minimalny przy niepełnym obsadzeniu nie stanowi konkurencyjnego progu.
Pipeline ustala konkurencyjność dopiero po połączeniu z liczbą miejsc.

## Kolejność publikacji i stan aktualności

Śledź niezależnie cztery stany:

1. wynik egzaminu CEM,
2. szczegółowe statystyki CEM z SD,
3. wykaz miejsc CMKP,
4. lista zakwalifikowanych CMKP.

Brak późniejszego etapu jest poprawnym stanem przejściowym. W raporcie zapisz
datę kontroli, najnowszy znaleziony okres i bezpośredni URL każdego artefaktu.
