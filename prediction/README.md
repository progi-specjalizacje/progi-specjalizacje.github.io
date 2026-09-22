# Prognozowanie progów rekrutacyjnych

Ten katalog zawiera dane i kolejne etapy prac nad prognozą progów rezydenckich na
poziomie `rekrutacja × specjalizacja × województwo`.

## Zakres pierwszej wersji

- tylko tryb rezydencki,
- miejsca doktoranckie są wyłączone,
- specjalizacje lekarskie są łączone z LEK,
- specjalizacje stomatologiczne są łączone z LDEK,
- chirurgia szczękowo-twarzowa, epidemiologia i zdrowie publiczne są pomijane,
- źródłem wyników są pliki `source_data/*_parsed.csv`,
- źródłem cech egzaminacyjnych jest
  `even more source data/cem_lek_ldek_wyniki_2023w_2026j.csv`, a odchylenia
  standardowego wyników wszystkich zdających w danej sesji
  `prediction/sources/cem_exam_standard_deviation.csv`. Wartości SD pochodzą
  z wierszy `OGÓŁEM`/`RAZEM` oficjalnych statystyk
  [LEK](https://www.cem.edu.pl/lep_s.php) i
  [LDEK](https://www.cem.edu.pl/ldep_s.php).

Uruchomienie:

```powershell
npm run prediction:data
npm run prediction:scope
npm run prediction:model
```

Oficjalne zbiorcze wykazy miejsc zapisane w manifeście można pobrać poleceniem:

```powershell
npm run prediction:download-places
```

PDF-y z wykazami miejsc są następnie parsowane tym samym mechanizmem ekstrakcji
tekstu (`pdfplumber`), którego używa dostarczony parser list wynikowych:

```powershell
python scripts/parse_cmkp_places.py
```

Parser zapisuje `prediction/data/cmkp_places.csv` oraz raport dopasowania nazw
`prediction/data/cmkp_places_quality_report.json`. Dopiero po tym kroku należy
uruchomić `prediction:data` i `prediction:scope`.

Polecenie tworzy:

- `prediction/data/recruitment_model_dataset.csv` - jedną obserwację dla każdej
  kombinacji rundy, specjalizacji i województwa, wraz z cechami LEK/LDEK;
- `prediction/data/data_quality_report.json` - liczności, zastosowane wykluczenia
  i znane ograniczenia danych.
- `prediction/data/model_scope_candidates.csv` - ocena historii na poziomie
  specjalizacja × województwo;
- `prediction/data/specialty_scope_summary.csv` - podsumowanie kandydatów do
  pilotażu według specjalizacji.
- `prediction/data/threshold_model_backtest.csv` - prognozy historyczne wykonane
  bez dostępu do przyszłych rund;
- `prediction/data/threshold_model_report.json` - metryki modelu z danymi
  egzaminacyjnymi i bez nich;
- `prediction/data/threshold_forecast_j-2026.csv` - prognozy dla jesieni 2026.
- `prediction/data/threshold_forecast_j-2026_pilot.csv` - zawężona prognoza dla
  stabilnych albo regularnie pełnych, wysokoprogowych kombinacji.
- `prediction/data/national_threshold_backtest.csv` - średnie progów według
  specjalizacji i tury w skali kraju oraz średnie regionalnych prognoz;
- `prediction/data/national_threshold_forecast_j-2026.csv` - prognozy średniego
  progu krajowego dla specjalizacji oferowanych jesienią 2026.

Oficjalne limity CMKP są łączone z wynikami po rundzie, województwie i
specjalizacji. Zbiór zawiera również pule z dodatnią liczbą miejsc, w których nie
odnotowano żadnej zakwalifikowanej osoby. Status `pelna_pula_proxy_konkurencji`
oznacza pełne obsadzenie miejsc, ale pozostaje wskaźnikiem zastępczym konkurencji:
publiczna lista niezakwalifikowanych nie ujawnia wariantów ani wyników kandydatów.

`egzamin_suma_przystapien_4_sesje` jest sumą zdających, a nie liczbą unikalnych
osób. Kandydat może przystępować do egzaminu wielokrotnie.

`egzamin_sd_proc` oznacza odchylenie standardowe wyniku egzaminu w danej sesji,
podzielone przez maksymalną liczbę punktów tej sesji. To inna wielkość niż
`odchylenie_wynikow_proc`, liczone z wyników osób zakwalifikowanych w danej
specjalizacji i województwie. `egzamin_sd_dostepne_proc` używa przede wszystkim
SD bieżącej sesji. Tylko gdy go jeszcze nie opublikowano, sięga do poprzedniej
sesji; pole `egzamin_sd_zrodlo` ujawnia, skąd pochodzi wartość. Dlatego w
historycznym teście jesieni 2025 wykorzystujemy jesienne SD, a dla prognozy
jesieni 2026 tymczasowo SD z wiosny 2026. W archiwum CEM szczegółowe
statystyki są obecnie dostępne do wiosny 2026.

Backtest na 952 progach porównuje wariant egzaminacyjny bez SD (MAE 3,119 pkt),
z bieżącym SD (3,590 pkt) i tylko z poprzednim SD (3,213 pkt). Pogorszenie po
dodaniu bieżącego SD jest największe w pierwszej testowanej turze (`j-2024`),
kiedy model uczył się tylko z trzech wcześniejszych tur. Są to eksperymenty
przeprowadzone na niewielkiej liczbie zmian statystyk egzaminu między sesjami.
Warianty z SD są zachowane do porównań; `prognoza_modelowa` nadal korzysta z
lepiej sprawdzonego modelu łączonego bez SD.

## Prognoza krajowa i ocena wiarygodnych kombinacji

Backtest osobno porównuje wszystkie warianty w grupie `scisly_stabilny_przed_runda`.
Kryteria tej grupy są obliczane tylko z rund wcześniejszych niż testowana, aby
wybór "najpewniejszych" kombinacji nie korzystał z późniejszych wyników.

Średni próg krajowy w rundzie to nieważona średnia progów województw, w których
oferowano miejsca i pula została całkowicie obsadzona. Województwo bez oferty
nie ma progu. Przy niepełnej puli wynik najniżej przyjętej osoby nie jest
konkurencyjnym progiem, dlatego taki region nie wchodzi do historycznej średniej
konkurencyjnej. Plik backtestu pokazuje obok liczbę regionów z ofertą, z
obserwowanym wynikiem oraz z pełną pulą.

Raport porównuje także drugą definicję: średnią najniższych wyników osób
przyjętych we wszystkich województwach z obserwowanym wynikiem, również gdy
miejsca pozostały wolne. Ma ona większe pokrycie, ale w niepełnej puli nie
oznacza progu konkurencyjnego.

Prognoza krajowa powstaje przez uśrednienie prognoz regionalnych dla wszystkich
województw z ofertą. Wersja ważona zwiększa udział regionów, które według
historii częściej zapełniały miejsca. Wagi są wygładzonym udziałem pełnych pul
z wcześniejszych rund: od częstości globalnej, przez specjalizację, po konkretny
region. Backtest krajowy ocenia wyłącznie tury z co najmniej trzema regionami
z ofertą, trzema pełnymi pulami i 80% udziałem pełnych pul. Jest to warunkowy,
stosunkowo mały zbiór. Dokładność dla rzadkich albo słabo obsadzanych
specjalizacji pozostaje nieznana; `zakres_oceny` w prognozie zaznacza, które
specjalizacje mają szerszą historię.

Kolumna `prognoza_krajowa_proc` wskazuje wariant o najniższym MAE w tym
konkurencyjnym backteście: średnią regionalnych prognoz bez cech egzaminu,
ważoną historyczną szansą pełnej puli. Pozostałe warianty pozostają w CSV do
porównania. Wybrany wariant nadal korzysta z historycznych progów i liczby
miejsc; brak cech egzaminacyjnych oznacza tylko, że ich aktualne zbiorcze
statystyki nie poprawiły dotychczasowej walidacji.

Grupa `A_stabilny_pilotaz` wymaga co najmniej pięciu rund z ofertą, czterech rund
z pełnym obsadzeniem, udziału pełnych rund co najmniej 70%, mediany co najmniej
trzech zakwalifikowanych i mediany progu co najmniej 75%. Grupa
`B_wysoki_prog_mala_pula` obejmuje mniejsze, ale regularnie pełne pule z medianą
progu co najmniej 85%. Są to jawne reguły selekcji do testów, a nie wynik modelu.
