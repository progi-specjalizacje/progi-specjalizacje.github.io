# AGENTS.md – parser wyników CMKP

## Cel

Parser list zakwalifikowanych SMK/CMKP (PDF -> CSV). Wyniki zasilaja strone przez `source_data/`.

1. Uzytkownik zapisuje zrodlowe PDF-y w `data_pipeline/results/pdfs/` jako `<runda>.pdf`.
2. Skrypt `parse_smk_ranking.py` wyciaga tekst z PDF przez `pdfplumber`.
3. Skrypt parsuje wiersze tabeli i metadane do CSV.
4. Wyniki trafiaja domyslnie do `source_data/<runda>_parsed.csv` (katalog glowny repo); nazwa rundy jest wyliczana z daty publikacji.

## Struktura

- `parse_smk_ranking.py` - glowny skrypt parsera PDF -> CSV.
- `pdfs/` - domyslny katalog wejsciowy ze zrodlowymi plikami PDF.
- `../../source_data/` - domyslny katalog wyjsciowy (dane strony).

## Uruchamianie parsera

Z katalogu glownego repo:

```powershell
npm run data:parse-results
```

Sciezki domyslne sa liczone wzgledem skryptu. Opcje:

```powershell
python data_pipeline/results/parse_smk_ranking.py --input-dir "sciezka/do/pdfow"
python data_pipeline/results/parse_smk_ranking.py --output "wynik.csv"
python data_pipeline/results/parse_smk_ranking.py --update-csv source_data
```

Bez `--output` kazdy plik wejsciowy jest parsowany do osobnego CSV w `source_data/` (istniejace pliki sa nadpisywane). Z `--output` wszystkie rekordy ze wszystkich plikow wejsciowych sa laczone w jednym wskazanym CSV. Opcja `--update-csv` pozwala zaktualizowac istniejace pliki CSV.

Kolumna `kolejność_plików` jest wyliczana w pelni automatycznie na podstawie pola `publication_date` jako liczba calkowita w formacie `YYYYMMDD` (np. `20231121`), co zachowuje naturalna chronologie i kompatybilnosc ze skryptami analitycznymi.

Do parsowania PDF wymagany jest pakiet `pdfplumber`:

```powershell
python -m pip install pdfplumber
```

## Obecny format danych

Parser rozpoznaje m.in.:

- date publikacji: `Data publikacji w systemie DD.MM.RRRR`,
- date wydruku i numer strony,
- wojewodztwo,
- sekcje zwykle i `Miejsca doktoranckie`,
- wiersze tabeli zawierajace: `Lp.`, dziedzine medycyny, numer wniosku, tryb szkolenia, punktacje, srednia arytmetyczna oraz date zlozenia wniosku.

Wynikowy CSV zawiera m.in. kolumny:

- `rekrutacja`,
- `kolejność_plików`,
- `publication_date`,
- `print_datetime`,
- `page`,
- `page_total`,
- `wojewodztwo`,
- `lp`,
- `dziedzina_medycyny`,
- `numer_wniosku`,
- `tryb_szkolenia`,
- `punktacja_proc`,
- `srednia_arytmetyczna`,
- `data_zlozenia_wniosku`,
- `ilość_zakwalifikowanych_w_trybie`,
- `czy_miejsca_doktoranckie`,
- `doktoranckie_podmiot`,
- `doktoranckie_jednostka`.

## Wskazowki dla agentow

- Nie cofaj istniejacych zmian w plikach wyjsciowych ani w danych, chyba ze uzytkownik wyraznie o to poprosi.
- Traktuj pliki w `pdfs/` i `source_data/` jako dane uzytkownika.
- Po zmianie parsera uruchom go ponownie i sprawdz `git diff source_data`; istniejace rundy nie powinny sie zmienic bez uzasadnienia.
- Przed zmiana parsera sprawdz przynajmniej jeden rzeczywisty plik PDF.
- Nie przenos plikow PDF z `pdfs/` po przetworzeniu, chyba ze uzytkownik wyraznie o to poprosi.
- Sciezka repo zawiera spacje; w poleceniach ujmuj ja w cudzyslowy.

## Znane ograniczenia

- Parser czyta PDF bezposrednio przez `pdfplumber`, ale zaklada obecny uklad tekstu w PDF-ach SMK.
- Regex wiersza zaklada konkretny uklad tekstu i moze nie obsluzyc zmienionego formatu PDF.
- Kolumna `kolejność_plików` jest wyliczana automatycznie z daty publikacji (`YYYYMMDD`), dzieki czemu parser nie wymaga interaktywnego wprowadzania kolejnosci.
- Niektore PDF-y moga zawierac naglowki wyciagane jako podwojone litery; skrypt normalizuje znane naglowki, ale nowe warianty moga wymagac dopisania obslugi.
