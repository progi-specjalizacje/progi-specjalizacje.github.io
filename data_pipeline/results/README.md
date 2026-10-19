# Parser List Rankingowych SMK (CMKP) – PDF do CSV

Narzędzie automatyzujące ekstrakcję danych z oficjalnych list rankingowych [CMKP](https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne). Skrypt przekształca nieustrukturyzowane listy publikowane w plikach PDF do czytelnych, ustandaryzowanych tabel CSV gotowych do analizy.

---

## Spis treści

1. [Skąd wziąć nowe dane o nowych rekrutacjach?](#skąd-wziąć-nowe-dane-o-nowych-rekrutacjach)
2. [Wymagania i instalacja](#wymagania-i-instalacja)
3. [Struktura katalogów](#struktura-katalogów)
4. [Instrukcja użycia skryptu](#instrukcja-użycia-skryptu)
5. [Skąd biorą się wartości poszczególnych kolumn w CSV](#skąd-biorą-się-wartości-poszczególnych-kolumn-w-csv)
   - [Tabela podsumowująca](#tabela-podsumowująca)
   - [Szczegółowy opis każdej kolumny](#szczegółowy-opis-każdej-kolumny)
6. [Logika działania parsera i przetwarzanie PDF](#logika-działania-parsera-i-przetwarzanie-pdf)
---

## Skąd wziąć nowe dane o nowych rekrutacjach?
Wejdź na stronę [CMKP > Postępowania Kwalifikacyjne](https://www.cmkp.edu.pl/ksztalcenie/postepowania-kwalifikacyjne), zescrolluj na sam dół, przejdź na podstronę odpowiedniego postępowania kwalifikacyjnego (np. ctrl+f: `Postępowanie kwalifikacyjne wiosna 2026`), następnie pobierz plik PDF o nazwie `Lista lekarzy zakwalifikowanych – postępowanie ...` i zapisz go w `data_pipeline/results/pdfs/` jako `<runda>.pdf` (np. `j-2026.pdf`).

## Wymagania i instalacja

- **Python 3.8+**
- Pakiet **`pdfplumber`**

```powershell
python -m pip install pdfplumber
```

## Struktura katalogów

```text
data_pipeline/results/
├── parse_smk_ranking.py   # Główny skrypt parsera
├── pdfs/                  # Źródłowe PDF-y list zakwalifikowanych (<runda>.pdf)
├── AGENTS.md              # Wytyczne techniczne dla agentów AI
└── README.md              # Niniejsza dokumentacja

source_data/               # (katalog główny repo) wynikowe <runda>_parsed.csv czytane przez stronę
```

Parser był wcześniej osobnym repozytorium
[proginaspecke/cmkp_wyniki_parse](https://github.com/proginaspecke/cmkp_wyniki_parse);
od października 2026 jest częścią tego repo.

---

## Instrukcja użycia skryptu

Domyślnie skrypt przeszukuje katalog `pdfs/` (obok skryptu) w poszukiwaniu plików `.pdf` i zapisuje dla każdego z nich osobny plik `<runda>_parsed.csv` bezpośrednio w `source_data/`. Nazwa pliku wynikowego jest wyliczana z daty publikacji w dokumencie. Ścieżki domyślne są liczone względem skryptu, więc można go uruchamiać z dowolnego katalogu, np. z katalogu głównego repo:

```powershell
npm run data:parse-results
# albo
python data_pipeline/results/parse_smk_ranking.py
```

Uwaga: przy domyślnym uruchomieniu parsowane są wszystkie PDF-y z `pdfs/`, a istniejące CSV w `source_data/` są nadpisywane. Przy niezmienionym parserze wynik jest identyczny jak dotychczasowe pliki, więc `git diff source_data` pokaże tylko nową rundę.

---

## Skąd biorą się wartości poszczególnych kolumn w CSV

Każdy wygenerowany plik CSV zawiera **18 ustandaryzowanych kolumn**. Poniżej znajduje się zestawienie oraz dokładne wyjaśnienie reguł, na podstawie których wypełniane jest każde pole.

### Tabela podsumowująca

| Nazwa kolumny | Typ / Przykładowa wartość | Źródło danych w dokumencie / Metoda wyliczenia |
| :--- | :--- | :--- |
| `rekrutacja` | `w-2026`, `j-2024` | Wyliczana z `publication_date`: miesiące 2-7 dają `w-<rok>`, miesiące 8-12 oraz 1 dają `j-<rok>` |
| `kolejność_plików` | `20260414` | Jest to liczba naturalna, na jeej podstawie można chronologicznie ustawić pliki  podczas późniejszej analizy, jest wyliczana  z `publication_date` w formacie `YYYYMMDD` |
| `publication_date` | `14.04.2026` | Nagłówek pliku: `Data publikacji w systemie DD.MM.RRRR` |
| `print_datetime` | `14.04.2026 12:16:11` | Stopka strony: `Data wydruku DD.MM.RRRR GG:MM:SS` |
| `page` | `1` | Bieżący numer strony ze stopki strony `Strona X z Y` |
| `page_total` | `85` | Całkowita liczba stron ze stopki strony `Strona X z Y` |
| `wojewodztwo` | `Dolnośląskie` | Nagłówek sekcji: `Województwo <Nazwa>` |
| `lp` | `1` | Pierwsza kolumna wiersza tabeli rankingowej (pozycja kandydata) |
| `dziedzina_medycyny` | `Anestezjologia i intensywna terapia` | Druga kolumna wiersza tabeli (nazwa specjalizacji) |
| `numer_wniosku` | `2026/011608` | Trzecia kolumna wiersza tabeli (format `RRRR/NNNNNN`) |
| `tryb_szkolenia` | `Rezydencki`, `Pozarezydencki` | Czwarta kolumna wiersza tabeli (tryb odbywania specjalizacji) |
| `punktacja_proc` | `88.52` | Piąta kolumna wiersza tabeli (wynik procentowy, np. z LEK/LDEK) |
| `srednia_arytmetyczna` | `4.54` | Szósta kolumna wiersza tabeli (średnia ocen ze studiów) |
| `data_zlozenia_wniosku` | `28.02.2026 18:35:45` | Siódma i ósma kolumna wiersza tabeli połączone spacją |
| `ilość_zakwalifikowanych_w_trybie` | `8` | Agregacja: zliczenie kandydatów o tym samym woj., dziedzinie i trybie |
| `czy_miejsca_doktoranckie` | `TAK` / `NIE` | Flaga sekcji dokumentu (`Miejsca doktoranckie`) |
| `doktoranckie_podmiot` | `Uniwersytet Medyczny we Wrocławiu` | Tekst nagłówkowy przed tabelą w sekcji doktoranckiej (linia 1) |
| `doktoranckie_jednostka` | `Katedra i Klinika Chirurgii Ogólnej` | Tekst nagłówkowy przed tabelą w sekcji doktoranckiej (linie 2+) |

---

### Szczegółowy opis każdej kolumny

#### 1. `rekrutacja`
- **Pochodzenie:** Wyliczana automatycznie na podstawie kolumny `publication_date`.
- **Format:** Litera postępowania i rok, np. `w-2026` lub `j-2024`.
- **Reguła:** Jeśli miesiąc w `publication_date` to `2`, `3`, `4`, `5`, `6` albo `7`, używana jest litera `w`. Jeśli miesiąc to `8`, `9`, `10`, `11`, `12` albo `1`, używana jest litera `j`. Po literze dodawany jest myślnik i rok z daty publikacji.
- **Zastosowanie:** Identyfikator naboru / sesji rekrutacyjnej.

#### 2. `kolejność_plików`
- **Pochodzenie:** Wyliczana automatycznie funkcją `publication_date_to_kolejnosc_plikow()`.
- **Mechanizm:** Pobiera datę z kolumny `publication_date` i konwertuje ją na liczbę całkowitą w formacie `YYYYMMDD` (np. data publikacji `14.04.2026` daje `20260414`).
- **Zastosowanie:** Umożliwia bezbłędne sortowanie chronologiczne w bazach danych i raportach Power BI, eliminując potrzebę ręcznego definiowania kolejności plików.

#### 3. `publication_date`
- **Pochodzenie:** Wykrywana wyrażeniem regularnym z nagłówka publikacji:
  ```regex
  ^Data publikacji w systemie\s+(\d{2}\.\d{2}\.\d{4})$
  ```
- **Mechanizm:** Po odnalezieniu w dokumencie zostaje zapamiętana w kontekście sesji i propagowana na wszystkie wiersze z danego pliku.

#### 4. `print_datetime`
- **Pochodzenie:** Odczytywana z nagłówka wydruku powtarzającego się na każdej stronie PDF:
  ```regex
  Data wydruku\s+(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})\s+Strona\s+(\d+)\s+z\s+(\d+)
  ```
- **Format:** `DD.MM.RRRR GG:MM:SS` (data i godzina wygenerowania zestawienia przez SMK).

#### 5. `page` oraz 6. `page_total`
- **Pochodzenie:** Odczytywane z tego samego nagłówka co `print_datetime` (odpowiednio grupy 2 i 3).
- **Znaczenie:** `page` to bieżąca strona w pliku PDF, a `page_total` to całkowita liczba stron tego dokumentu.

#### 7. `wojewodztwo`
- **Pochodzenie:** Śledzone za pomocą stanu parsera (`ParseContext.wojewodztwo`).
- **Mechanizm:** Parser dopasowuje linie nagłówkowe sekcji terytorialnych:
  - Dla zwykłych list: `^Wojew.dztwo\s+(.+)$` (np. `"Województwo Mazowieckie"` -> `"Mazowieckie"`).
  - Dla sekcji doktoranckich: `^Wojew.dztwo\s+(.+?)\s+-\s+Miejsca doktoranckie$` (np. `"Województwo Dolnośląskie - Miejsca doktoranckie"` -> `"Dolnośląskie"`).
  Wartość obowiązuje dla wszystkich kolejnych wierszy aż do wystąpienia następnego nagłówka województwa.

#### 8. `lp`
- **Pochodzenie:** Pierwsza liczba wiersza tabeli rankingowej dopasowana przez `ROW_RE`.
- **Znaczenie:** Numer kolejny kandydata zakwalifikowanego w danym zestawieniu.

#### 9. `dziedzina_medycyny`
- **Pochodzenie:** Druga grupa dopasowania wiersza tabeli.
- **Znaczenie:** Nazwa specjalizacji (np. `Kardiologia`, `Medycyna rodzinna`, `Pediatria`).

#### 10. `numer_wniosku`
- **Pochodzenie:** Trzecia grupa dopasowania wiersza tabeli.
- **Format:** Zawsze 4 cyfry roku, ukośnik i 6 cyfr porządkowych, np. `2026/011608`.
- **Znaczenie:** Unikalny numer zgłoszenia w systemie SMK identyfikujący anonimowo kandydata.

#### 11. `tryb_szkolenia`
- **Pochodzenie:** Czwarta grupa dopasowania wiersza tabeli.
- **Wartości:** Najczęściej `Rezydencki` (etat rezydencki) lub `Pozarezydencki` (np. etat szpitalny, wolontariat, studia doktoranckie).

#### 12. `punktacja_proc`
- **Pochodzenie:** Piąta grupa dopasowania wiersza tabeli. W oryginalnym dokumencie występuje z symbolem `%` (np. `88.52%`).
- **Format:** Zapisywana jako ustandaryzowana liczba zmiennoprzecinkowa z kropką, bez znaku procenta (np. `88.52`).

#### 13. `srednia_arytmetyczna`
- **Pochodzenie:** Szósta grupa dopasowania wiersza tabeli.
- **Znaczenie:** Średnia ocen ze studiów wyliczona z dokładnością do dwóch miejsc po przecinku (np. `4.54`). Jest to pierwsze kryterium rozstrzygające w przypadku równej liczby punktów z LEK/LDEK. Jeśli kandydat nie podał średniej lub system przyjął wartość zerową, występuje `0.00`.

#### 14. `data_zlozenia_wniosku`
- **Pochodzenie:** Siódma (data `DD.MM.RRRR`) oraz ósma (godzina `GG:MM:SS`) grupa dopasowania wiersza tabeli, połączone pojedynczą spacją (np. `28.02.2026 18:35:45`).
- **Znaczenie:** Drugie kryterium rozstrzygające w przypadku remisu punktowego i równej średniej arytmetycznej (o zakwalifikowaniu decyduje wcześniejsza data i czas złożenia wniosku w SMK).

#### 15. `ilość_zakwalifikowanych_w_trybie`
- **Pochodzenie:** Obliczana analitycznie po zakończeniu parsowania dokumentu przez funkcję `add_ilosc_zakwalifikowanych_w_trybie()`.
- **Zasada wyliczenia:** Wykorzystuje licznik `collections.Counter` grupujący rekordy po kluczu krotki:
  ```python
  (wojewodztwo, dziedzina_medycyny, tryb_szkolenia, czy_miejsca_doktoranckie)
  ```
- **Znaczenie:** Wartość ta natychmiast informuje, ile łącznie osób zostało zakwalifikowanych na daną specjalizację w danym województwie i w danym trybie. Odpowiada to liczbie miejsc faktycznie obsadzonych w danej rekrutacji.

#### 16. `czy_miejsca_doktoranckie`
- **Pochodzenie:** Flaga ustawiana na podstawie aktualnego stanu sekcji dokumentu (`ctx.section`).
- **Wartości:**
  - `TAK` – jeśli wiersz znajduje się w sekcji `Miejsca doktoranckie`.
  - `NIE` – dla regularnych list rankingowych.

#### 17. `doktoranckie_podmiot` oraz 18. `doktoranckie_jednostka`
- **Pochodzenie:** Wyciągane z linii tekstu występujących pomiędzy nagłówkiem sekcji doktoranckiej a nagłówkiem tabeli (`extract_doctoral_location()`).
- **Zasady:**
  - `doktoranckie_podmiot`: pierwsza linia opisu lokalizacji (zazwyczaj uczelnia lub podmiot leczniczy).
  - `doktoranckie_jednostka`: druga i ewentualne kolejne linie (szpital kliniczny, oddział, klinika).
  - Dla zwykłych wierszy (`czy_miejsca_doktoranckie == "NIE"`) obie kolumny są puste (`""`).

---

## Logika działania parsera i przetwarzanie PDF

1. **Ekstrakcja tekstu z PDF:**
   Pliki PDF są otwierane przez bibliotekę `pdfplumber` z parametrami `x_tolerance=1` i `y_tolerance=3`, co zapewnia precyzyjne odtworzenie układu wierszy tabelarycznych.
2. **Normalizacja zniekształceń czcionek (ang. *doubled glyphs*):**
   Niektóre pliki PDF z systemu SMK mają specyficzny błąd renderowania, powodujący podwojenie liter w nagłówkach (np. `WWoojjeewwóóddzzttwwoo`). Funkcja `normalize_pdf_line()` wykrywa takie anomalie i składa znaki z powrotem do poprawnej formy.
3. **Filtrowanie elementów zbędnych (*boilerplate*):**
   Automatycznie odrzucane są powtarzające się klauzule prawne i stopki SMK (np. `"Status dokumentu"`, `"SMK System Monitorowania"`, `"Dokument został utworzony"`).
4. **Maszyna stanów (kontekst):**
   Parser czyta plik sekwencyjnie linia po linii, aktualizując obiekt `ParseContext` (województwo, tryb doktorancki, strona, data publikacji). Po napotkaniu wiersza pasującego do wzorca kandydata (`ROW_RE`), tworzony jest gotowy słownik rekordu.
5. **Postprocessing:**
   Przed zapisem wyliczana jest liczba zakwalifikowanych, identyfikator `rekrutacja` oraz klucz sortujący `kolejność_plików`.