> **Archiwum (październik 2026).** Model prognoz progów i zapełnienia nie jest częścią
> strony ani builda. Ten katalog jest migawką dawnego `prediction/` razem ze skryptami
> (dawniej w `scripts/`, teraz w `scripts/` tutaj) i skillem `cmkp-cem-data-refresh`.
>
> Co zmieniło się przy archiwizacji:
>
> - Wykaz miejsc CMKP jest nadal używany przez stronę, więc został przeniesiony do
>   `data_pipeline/places/` (manifest, PDF-y, pobieranie, parser), a
>   `prediction/data/cmkp_places.csv` jest teraz `source_data/cmkp_places.csv`.
> - Audyt źródeł (`audit_local_sources.mjs`) został okrojony do danych strony i
>   przeniesiony do `data_pipeline/audit.mjs`; część CEM i sprawdzanie prognoz usunięto.
> - Skrypty `npm run prediction:*` usunięto z `package.json`.
>
> Ścieżki w skryptach i w tym opisie wskazują dawne lokalizacje (`prediction/...`,
> `scripts/...`), więc nie uruchomią się stąd bez zmian. Aby przywrócić pipeline:
> przenieś `archive/prediction/` z powrotem do `prediction/`, `scripts/*` do `scripts/`,
> wskaż w nich `source_data/cmkp_places.csv` jako plik miejsc i dodaj skrypty
> `prediction:*` do `package.json` (lista w historii git przed tą zmianą).

> **Korekta (październik 2026).** Trener modelu (`trainThresholdModel.js`, `isFillObservation`) pomijał pule niepełne
> z zakwalifikowanymi: szukał statusu `niepelna_pula_brak_progu_konkurencyjnego`, którego dataset nie zawiera (nazywa się
> `niepelna_pula`). Model zapełnienia uczył się więc głównie na pulach pełnych i zawyżał szansę pełnej puli (dla j-2026
> oczekiwane 589 pełnych pul wobec 351 w j-2025, np. medycyna rodzinna 0,93 przy historii bliskiej 0). Po poprawce
> oczekiwane są 355 pełne pule, a medycyna rodzinna 0,03. Prognozy progów (`prognoza_modelowa`) i ich MAE (2,74) nie
> zmieniły się; zmieniły się kolumny `prawdopodobienstwo_pelnej_puli*`, backtest zapełnienia (2884 obserwacje zamiast
> 1712, Brier surowy 0,137) i pliki pochodne. Liczby w opisach poniżej dotyczące zapełnienia pochodzą sprzed korekty.

# Prognozowanie progów i zapełnienia miejsc

## Eksperyment dwuczęściowy: pule zagrożone i konkurencyjne

`npm run prediction:model` uruchamia także `scripts/twoPartThresholdExperiment.js`.
Diagnostyka backtestu pokazała, że błąd koncentruje się w pełnych pulach
obsadzonych „na styk”: przy szansie pełnej puli poniżej 0,6 MAE produkcji wynosi
około 6 pkt proc., a przy szansie co najmniej 0,9 około 2. Eksperyment sprawdza,
czy jawne rozdzielenie tych reżimów pomaga. Produkcja się nie zmienia.

Bramką jest surowa szansa pełnej puli z produkcyjnego modelu zapełnienia, uczonego
wyłącznie na rundach wcześniejszych niż runda danej obserwacji. Cel zapełnienia
pozostaje osobny; szansa służy tylko do przypisania segmentu. Pula z szansą
poniżej 0,8 trafia do segmentu `ryzyko_zalamania_progu`, pozostałe do
`konkurencyjna`. Próg 0,8 ustalono po tej diagnostyce, dlatego wynik jest
eksploracyjny; progi 0,6, 0,7 i 0,9 są raportowane tylko jako wrażliwość.

Porównywane warianty na tych samych 952 progach:

| Wariant | MAE | MAE konkurencyjne (779) | MAE ryzyko (173) |
| --- | ---: | ---: | ---: |
| Bazowy ridge | 2,831 | 2,248 | 5,457 |
| Obecny produkcyjny ensemble | **2,744** | 2,151 | **5,410** |
| Ridge z logitem szansy zapełnienia | 3,674 | 3,065 | 6,418 |
| Dwuczęściowy (produkcja / osobny ridge ryzyka) | 2,828 | 2,151 | 5,873 |
| Mieszanina `p × produkcja + (1 − p) × ridge ryzyka` | 2,748 | **2,146** | 5,458 |

Żaden wariant punktowy nie poprawia produkcji. Osobny ridge dla segmentu ryzyka
ma mało danych (0, 58, 143 i 226 obserwacji uczących w kolejnych rundach; w
`j-2024` używana jest produkcja) i nie przewiduje głębokości załamania progu.
Cecha szansy w jednym modelu jest niestabilna między rundami.

Wartość segmentacji leży w przedziałach. Przedziały 80% powstają z kwantyli 10/90
reszt wyłącznie wcześniejszych rund backtestu, oceniane od `w-2025`:

| Przedział | Pokrycie konkurencyjne | Szerokość | Pokrycie ryzyko | Szerokość |
| --- | ---: | ---: | ---: | ---: |
| Wspólny wokół produkcji | 85,4% | 7,6 | **53,2%** | 7,5 |
| Segmentowy wokół produkcji | 82,7% | **6,5** | 70,5% | 14,7 |

Wspólny przedział jest zbyt szeroki dla pul konkurencyjnych i wyraźnie zbyt
wąski dla zagrożonych. Przedział segmentowy jest węższy tam, gdzie prognoza jest
pewna, i uczciwiej pokazuje ryzyko spadku progu, choć w segmencie ryzyka nadal
nie osiąga nominalnych 80%. Przedział segmentowy wokół produkcji dodano po
pierwszym uruchomieniu eksperymentu, więc również wymaga potwierdzenia.

Zamrożona prognoza shadow jesieni 2026
(`prediction/data/two_part_shadow_forecast_j-2026.csv`) zawiera segment,
prognozę produkcyjną, prognozę dwuczęściową i oba przedziały. Do segmentu ryzyka
trafia 327 z 802 pul, w tym wiele bez historii pełnego obsadzenia. Backtest jest
w `prediction/data/two_part_threshold_backtest.csv`, a metryki w sekcji
`two_part_experiment` pliku `threshold_model_report.json`. Testy:
`node --test scripts/twoPartThresholdExperiment.test.js`.

## Eksperyment relatywnej skali liczby miejsc

`npm run prediction:model` porównuje także warianty, które jawnie rozróżniają,
czy bieżąca liczba miejsc jest duża albo mała dla konkretnej specjalizacji.
Eksperyment nie zmienia prognozy produkcyjnej. Używa wyłącznie informacji
znanych przed rundą i tego samego backtestu rolling-origin obejmującego 952
regionalne progi konkurencyjne.

Wariant `current_context` dodaje krajową liczbę miejsc w specjalizacji, liczbę
województw z ofertą, zmianę krajowej podaży oraz udział danego województwa w
krajowej puli. Wariant `relative_to_history` porównuje bieżącą podaż z medianą
wcześniejszych rund osobno dla całej specjalizacji i dla komórki
specjalizacja–województwo. Używana cecha ma postać
`log((bieżące miejsca + 1) / (historyczna mediana + 1))`. `combined` łączy oba
zestawy.

| Wariant | MAE | RMSE | Bias | P80 błędu |
| --- | ---: | ---: | ---: | ---: |
| Bazowy ridge | 2,831 | 4,357 | -0,202 | 4,063 |
| Obecny produkcyjny ensemble | 2,744 | 4,328 | 0,122 | **3,872** |
| Bieżący kontekst podaży | 2,808 | 4,320 | -0,128 | 4,084 |
| Podaż względem własnej historii | 2,789 | 4,318 | -0,120 | 3,988 |
| Wszystkie cechy podaży | 2,753 | **4,265** | -0,096 | 4,023 |
| Średnia 50/50 produkcja + wszystkie cechy podaży | **2,724** | 4,274 | **0,013** | 3,942 |

Pełny wariant podaży poprawia bazowy ridge, ale sam minimalnie przegrywa z
produkcyjnym ensemble pod względem MAE (`2,753` wobec `2,744`). Wygrywa za to
RMSE. Średnia 50/50 osiąga najniższe łączne MAE `2,724`, poprawiając 488 z 952
prognoz i pogarszając 464. Wynik nie jest jednak stabilny między rundami:
średnia 50/50 wygrywa w obu rundach wiosennych, a przegrywa w obu jesiennych.
Poprawia zarówno LEK (`2,914` wobec `2,924`), jak i LDEK (`1,736` wobec
`1,807`), ale dla LEK różnica jest bardzo mała.

Wariant 50/50 sprawdzono po obejrzeniu wyników cech podaży, dlatego jest analizą
post hoc, a nie niezależnie potwierdzonym ulepszeniem. Zamrożona prognoza shadow
jesieni 2026 znajduje się w
`prediction/data/supply_scale_shadow_forecast_j-2026.csv`; produkcja pozostaje
bez zmian. Backtest jest zapisany w
`prediction/data/supply_scale_threshold_backtest.csv`, a komplet metryk w sekcji
`supply_scale_experiment` pliku `threshold_model_report.json`.

## Model skupiony na wskazanych specjalizacjach

`npm run prediction:model` uruchamia także `scripts/focusedThresholdModel.js`.
Lista 10 specjalizacji jest jawnie zapisana w `FOCUSED_SPECIALTIES`.
Wersja focused-v2 obejmuje także ortodoncję i chirurgię stomatologiczną (LDEK).
Zakres pozostaje rezydencki, bez miejsc doktoranckich. Brak specjalizacji
w zbiorze nie jest zastępowany inną specjalizacją ani prognozą bez danych.

Celem jest regionalny próg przy pełnej puli. Porównujemy istniejący ensemble,
ridge (lambda 20) trenowany tylko na wskazanych specjalizacjach oraz stałą
średnią 50/50 obu prognoz. Ridge korzysta z dotychczasowych bazowych cech
historii; ich globalne podsumowania nadal obejmują inne specjalizacje.
Nie ograniczamy informacji historycznej, tylko obserwacje uczące ridge.
Prawdopodobieństwo zapełnienia pochodzi z osobnego, niezmienionego modelu.

Kryterium wyboru to macro MAE: najpierw MAE każdej specjalizacji, następnie
ich nieważona średnia. Duże specjalizacje nie dominują kryterium liczbą regionów.
Wybór jest wspólny dla całej grupy, na podstawie wyłącznie wcześniejszych
prognoz poza próbą. Wymagane są dwie wcześniejsze rundy walidacyjne;
wcześniej stosowany jest model produkcyjny, również przy remisie.
Każda runda trenuje ridge od nowa na wcześniejszych wynikach. Ocena obejmuje
identyczne pełne pule z co najmniej jednym wcześniejszym progiem konkurencyjnym.
Prognozy bez takiej historii są oznaczone jako ekstrapolacja.

Wyniki są eksperymentalne i nie zmieniają dashboardu ani modelu produkcyjnego:

- `prediction/data/focused_threshold_backtest.csv`: sparowane prognozy regionalne;
- `prediction/data/focused_threshold_forecast_j-2026.csv`: prognozy i osobne szanse zapełnienia;
- `focused_specialties` w `threshold_model_report.json`: pokrycie wszystkich
  10 specjalizacji, MAE/RMSE/bias/P80 i macro MAE, wyniki według rund oraz
  historia wyboru wariantu. `promotion_eligible_on_macro_mae` sprawdza tylko
  brak pogorszenia głównej metryki, nie stanowi automatycznej decyzji wdrożeniowej.

Specjalizacje bez progów do oceny nie wchodzą do macro MAE. Cztery rundy
backtestu i ponowne wykorzystanie znanej historii nie zapewniają niezależnego
potwierdzenia poprawy; potrzebna jest ocena przyszłej zakończonej rundy.
Ten eksperyment nie optymalizuje krajowego średniego progu.
Testy: `node --test scripts/focusedThresholdModel.test.js`.

Wynik focused-v2: 274 sparowane obserwacje regionalne, wszystkie 10
specjalizacji ma obserwacje testowe. Ortodoncja ma 33, a chirurgia
stomatologiczna 35 obserwacji. Prognoza obejmuje 121 pul regionalnych.
Macro MAE obecnego modelu wynosi 2,596 pkt proc., wąskiego ridge 2,499,
a procedury wyboru wyłącznie na wcześniejszych rundach 2,560.
Zwykłe MAE wynosi odpowiednio 2,295, 2,206 i 2,256.
Na jesień 2026 procedura wybiera wąski ridge. Jego RMSE jest jednak
gorsze od produkcji (3,760 wobec 3,677), więc poprawa MAE nie oznacza
poprawy wszystkich miar błędu.
Nie należy interpretować średniej poprawy jako potwierdzonej przewagi dla
każdej z 10 specjalizacji.

## Eksperyment historycznych rankingów zakwalifikowanych

`npm run prediction:model` uruchamia również `scripts/rankingExperiment.js`.
Eksperyment nie zmienia produkcyjnej prognozy ani modelu zapełnienia. Korzysta
z 18 608 obserwacji zakwalifikowanych w siedmiu rundach (nie oznacza to unikalnych
osób między rundami), wyłącznie rezydentur bez miejsc doktoranckich i bez
specjalizacji mieszanych. Numer wniosku służy tylko do kontroli duplikatów
wewnątrz rundy; nie trafia do wygenerowanych plików. Nie znaleziono duplikatów.
Sprzeczne przydziały tego samego numeru w jednej rundzie zatrzymują eksperyment.

Rankingi powstają osobno dla LEK i LDEK. Percentyl oznacza pozycję wśród
zakwalifikowanych, nie wszystkich kandydatów ani zdających egzamin. Większy
percentyl oznacza wyższy wynik. Remisy otrzymują środkową pozycję; na granicy
najlepszych 10%/20% ich udział jest ułamkowy, dzięki czemu suma wag odpowiada
dokładnie 10%/20% puli, także w małych grupach.

Do bazowego modelu ridge (lambda 20, bez strojenia na wynikach eksperymentu)
dodawane są trzy ustalone warianty cech:

- `profile`: regionalne Q25, mediana i rozstęp międzykwartylowy punktacji;
- `ranking`: regionalny percentyl minimum i mediany, udział specjalizacji
  w krajowym top 10%/20% danej ścieżki oraz udział tych grup wśród przyjętych
  na specjalizację;
- `combined`: oba zestawy razem.

Każda obserwacja korzysta z ostatniej wcześniejszej obserwowanej rundy tej samej
specjalizacji i województwa z tego samego sezonu, a przy jej braku z ostatniej
wcześniejszej rundy dowolnego sezonu. Krajowe udziały pochodzą z tej samej rundy
co profil regionalny. Przy braku historii cechy są uzupełniane średnią wyłącznie
ze zbioru treningowego. Profile obejmują także historyczne niepełne pule,
ale cel prognozy nadal obejmuje tylko pełne pule. Nie używa się aktualności
CMKP ani wyników przewidywanej rundy do budowy jej cech.

Porównanie na tych samych 952 progach regionalnych i 49 obserwacjach krajowych:

| Wariant | MAE regionalne (pkt proc.) | MAE krajowe (pkt proc.) |
| --- | ---: | ---: |
| Bazowy ridge | 2,831 | 1,365 |
| Obecny produkcyjny ensemble | 2,744 | 1,274 |
| Profile punktowe | 2,793 | 1,346 |
| Tylko pozycje percentylowe | 2,821 | 1,286 |
| Tylko udziały top 10%/20% | 2,793 | 1,170 |
| Ranking | 2,787 | 1,151 |
| Profile i ranking | 2,784 | 1,165 |
| Stałe częściowe łączenie kraj–specjalizacja–województwo | 2,825 | 1,251 |
| Częściowe łączenie i udziały top 10%/20% | 2,803 | 1,124 |

Krajowa agregacja używa tych samych historycznych wag zapełnienia i tego samego
warunkowego zbioru oceny co obecny model (minimum trzy regiony z ofertą,
trzy pełne pule i co najmniej 80% pełnych pul). Wariant rankingowy poprawia
krajowe MAE względem produkcji w trzech z czterech rund, ale jesienią 2025 jest
gorszy (1,198 wobec 1,040). Wiosną 2026 przegrywa też z prostym ridge
(1,438 wobec 1,337). Krajowy 80. percentyl błędu rośnie względem produkcji
z 1,632 do 1,853 pkt proc., mimo poprawy MAE i RMSE. Regionalnie brak poprawy
względem produkcji, a dla LDEK ranking przegrywa także z prostym ridge
(1,814 wobec 1,695). Nie ma podstaw do automatycznej zamiany modelu.

Diagnostyka wskazuje, że krajowy sygnał pochodzi przede wszystkim z udziałów
specjalizacji w top 10%/20% (MAE 1,170), a same pozycje percentylowe praktycznie
nie poprawiają produkcji (1,286 wobec 1,274). Pełny ranking wygrywa w 31 z 49
porównań specjalizacja-runda. Średnie MAE poprawia się dla 14 z 24 ocenionych
specjalizacji, a pogarsza dla 10. Po wyłączeniu kolejno każdej specjalizacji
przewaga pełnego rankingu pozostaje dodatnia i wynosi od 0,094 do 0,154 pkt
proc.; wynik nie zależy więc wyłącznie od jednej specjalizacji. Jest jednak
niestabilny między rundami: ranking przegrywa z produkcją jesienią 2025.

Pierwszy wariant hierarchiczny stosuje z góry ustalone, niestrojone częściowe
łączenie średnich: średnia specjalizacji jest przesuwana w stronę średniej
globalnej z wagą wcześniejszą 8, a średnia komórki specjalizacja–województwo
w stronę tej wartości z wagą wcześniejszą 3. Sama kotwica hierarchiczna nie
poprawia wyniku regionalnego. Połączenie jej z udziałami top 10%/20% daje
najniższe krajowe MAE 1,124, ale wariant powstał po analizie dotychczasowego
backtestu i nie jest niezależnie potwierdzony. Nie został wybrany do zamrożonej
prognozy ani do produkcji.

### Zamrożona prognoza testowa jesień 2026

Plik `prediction/data/ranking_shadow_forecast_j-2026.csv` zawiera prognozę
`ranking-shares-v1` dla 68 specjalizacji, zamrożoną 23 września 2026 r. Wariant
wykorzystuje wyłącznie udziały specjalizacji w top 10%/20% oraz dotychczasowe
cechy bazowe. Jest agregowany tymi samymi historycznymi wagami zapełnienia co
krajowy backtest. Status `shadow_do_oceny_po_publikacji_wynikow` oznacza, że
prognoza nie wpływa na prezentowany wynik produkcyjny. Po publikacji wyników
jesieni 2026 należy ocenić dokładnie ten plik, bez ponownego trenowania lub
zmiany konfiguracji przed porównaniem.

To eksploracyjna ocena na czterech rundach, nie niezależne potwierdzenie
skuteczności ani rekonstrukcja preferencji. Zapisane wyniki:

- `prediction/data/ranking_experiment_features.csv`: cechy oraz runda ich źródła;
- `prediction/data/ranking_experiment_regional_backtest.csv`: porównanie regionalne;
- `prediction/data/ranking_experiment_national_backtest.csv`: porównanie krajowe;
- `prediction/data/ranking_experiment_specialty_diagnostics.csv`: poprawa lub
  pogorszenie według specjalizacji oraz liczba wygranych rund;
- `prediction/data/ranking_shadow_forecast_j-2026.csv`: zamrożona krajowa
  prognoza testowa oparta na udziałach top 10%/20%;
- sekcja `ranking_experiment` w `threshold_model_report.json`: metryki łączne,
  według rund, LEK/LDEK oraz stabilnych regionalnych pul.

Testy remisów i chronologicznego wyboru historii:
`node --test scripts/rankingExperiment.test.js`.

## Pilotaż danych placówkowych CMKP

Osobny, nieprodukcyjny pilotaż sprawdza możliwość wydobycia placówki, adresu,
miasta i liczby wolnych miejsc z wojewódzkich PDF-ów CMKP. Obejmuje trzy
województwa (`Dolnośląskie`, `Mazowieckie`, `Warmińsko-mazurskie`) i osiem rund
od `w-2023` do `j-2026`. Źródła są zapisane w
`prediction/sources/cmkp_facility_pilot_manifest.json`.

```bash
npm run prediction:download-facility-pilot
npm run prediction:facility-pilot
npm run prediction:facility-geography
```

Parser generuje `prediction/data/cmkp_facility_pilot.csv` oraz raport jakości
`prediction/data/cmkp_facility_pilot_report.json`. Etap geograficzny łączy kod
pocztowy z lokalnie zachowaną kopią GeoNames i generuje
`cmkp_facility_geography_features.csv` oraz
`cmkp_facility_geography_report.json`. Jawna definicja dużych i akademickich
miast znajduje się w `prediction/sources/city_classification_pilot.json`.
Pole `liczba_wolnych_miejsc` oznacza
dostępną pojemność szkoleniową z listy wojewódzkiej, a nie potwierdzony przydział
miejsc rezydenckich do konkretnej placówki.

Trzy eksperymentalne cechy, ważone pojemnością szkoleniową, to udział miejsc w
dużych miastach, udział miejsc w miastach akademickich i średnia odległość od
stolicy województwa. Są dołączone do datasetu, lecz oceniane wyłącznie na
identycznym podzbiorze trzech województw z pokryciem geograficznym co najmniej
95%. Rolling-origin backtest progu obejmuje 190 obserwacji: MAE wariantu bazowego
to 3,347, a wariantu ze wszystkimi trzema cechami 3,373. W modelu zapełnienia na
308 obserwacjach Brier score wynosi odpowiednio 0,1211 i 0,1217. Cechy pozostają
diagnostyczne i nie zmieniają prognozy produkcyjnej.

Ten katalog zawiera dane i kolejne etapy prac nad dwiema odrębnymi prognozami na
poziomie `rekrutacja × specjalizacja × województwo`:

- konkurencyjnym progiem punktowym, jeżeli pula zostanie całkowicie obsadzona;
- prawdopodobieństwem całkowitego zapełnienia oferowanej puli miejsc.

## Zakres pierwszej wersji

- tylko tryb rezydencki,
- miejsca doktoranckie są wyłączone,
- specjalizacje lekarskie są łączone z LEK,
- specjalizacje stomatologiczne są łączone z LDEK,
- chirurgia szczękowo-twarzowa, epidemiologia i zdrowie publiczne są pomijane,
- źródłem wyników są pliki `source_data/*_parsed.csv`,
- źródłem cech egzaminacyjnych jest
  `prediction/sources/cem_lek_ldek_wyniki_2023w_2026j.csv`, a odchylenia
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
  i znane ograniczenia danych;
- `prediction/data/model_scope_candidates.csv` - ocena historii na poziomie
  specjalizacja × województwo;
- `prediction/data/specialty_scope_summary.csv` - podsumowanie kandydatów do
  pilotażu według specjalizacji;
- `prediction/data/threshold_model_backtest.csv` - prognozy historyczne wykonane
  bez dostępu do przyszłych rund;
- `prediction/data/threshold_model_report.json` - metryki modelu z danymi
  egzaminacyjnymi i bez nich;
- `prediction/data/threshold_forecast_j-2026.csv` - prognozy dla jesieni 2026;
- `prediction/data/threshold_forecast_j-2026_pilot.csv` - zawężona prognoza dla
  stabilnych albo regularnie pełnych, wysokoprogowych kombinacji;
- `prediction/data/national_threshold_backtest.csv` - średnie progów według
  specjalizacji i tury w skali kraju oraz średnie regionalnych prognoz;
- `prediction/data/national_threshold_forecast_j-2026.csv` - prognozy średniego
  progu krajowego dla specjalizacji oferowanych jesienią 2026;
- `prediction/data/fill_model_backtest.csv` - historyczne prognozy zapełnienia,
  wykonane bez dostępu do wyniku testowanej rundy; zawiera prawdopodobieństwo
  surowe, wariant kalibracyjny i dotychczasową heurystykę historyczną;
- `prediction/data/fill_forecast_j-2026.csv` - prawdopodobieństwa pełnego
  obsadzenia miejsc jesienią 2026 dla specjalizacji i województw z ofertą;
- `prediction/data/geography_threshold_backtest.csv` - porównanie progu na tym
  samym podzbiorze z cechami geograficznymi i bez nich;
- `prediction/data/geography_fill_backtest.csv` - analogiczne porównanie
  prawdopodobieństwa zapełnienia.

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
lepiej sprawdzonego modelu bez cech egzaminacyjnych.

## Warianty modelu progu

Walidacja rolling-origin porównuje obecnie cztery warianty bez danych
egzaminacyjnych:

- regresję ridge przewidującą bezpośrednio poziom progu;
- ten sam model z osobnymi trendami dla rund wiosennych i jesiennych, czyli
  interakcją sezonu z upływem czasu;
- regresję ridge przewidującą zmianę względem ostatniego konkurencyjnego progu
  z tego samego sezonu (albo ostatniego dowolnego progu, gdy brak takiej
  obserwacji);
- eksperymentalny wariant z historyczną średnią dla specjalizacji w grupie
  podobnych województw.

Samodzielne MAE tych wariantów na 952 progach wynosi odpowiednio `2,831`,
`2,870`, `3,348` i `2,948` pkt. Model zmiany oraz sezon × trend nie są więc
lepszymi samodzielnymi zamiennikami modelu poziomu. Niosą jednak częściowo inną
informację: jawny ensemble `60% poziom + 20% sezon × trend + 20% zmiana progu`
osiąga MAE `2,744` pkt. Pole `prognoza_modelowa` i jego przedział błędu korzystają
z tego ensemble.

Poprawa ensemble wystąpiła w trzech z czterech testowanych rund, ale wiosną
2026 wynik był gorszy od modelu poziomu (`2,965` wobec `2,881`). Wagi zostały
dobrane po porównaniu na obecnym backteście, dlatego traktujemy je jako
eksploracyjne do czasu niezależnego potwierdzenia w kolejnej rundzie. W grupie
o najwyższej pewności prosty model poziomu nadal jest minimalnie lepszy
(`1,149` wobec `1,162` pkt).

Hipoteza grup województw rozróżnia duże ośrodki, województwa potencjalnie
odpływowe oraz pozostałe regiony. Ponieważ wariant grupowy nie obniżył MAE, nie
jest używany w głównej prognozie. To grupowanie nie jest jeszcze pomiarem salda
migracji ani atrakcyjności miasta; takie dane należy dodać jako jawne,
zmieniające się w czasie cechy i ponownie sprawdzić bez przecieku z rundy
testowej.

Przypadki z nietypowo niskim rzeczywistym progiem pozostają w backteście.
Usunięcie ich po poznaniu wyniku sztucznie zaniżyłoby błąd. Do publikacji można
natomiast stosować kryteria znane przed rundą (`grupa_pilotazowa`, długość
historii, historyczne zapełnienie i przewidywane prawdopodobieństwo pełnej
puli), a dla niestabilnych kombinacji podawać szeroki przedział albo nie
publikować punktowej prognozy.

## Model zapełnienia

Model zapełnienia jest regresją logistyczną z regularyzacją ridge. Celem jest
`1` dla statusu `pelna_pula_proxy_konkurencji` i `0` dla poprawnie
zaobserwowanej niepełnej puli. Wiersze bez oferty, bez dostępnego wyniku rundy
albo z niespójną liczbą miejsc nie są przykładami uczącymi tego celu.

Model korzysta wyłącznie z informacji znanych przed rekrutacją: liczby miejsc
w województwie, krajowej podaży miejsc w specjalizacji, zmiany podaży, liczby
województw z ofertą, poprzedniego zapełnienia, historycznych udziałów pełnych
pul, specjalizacji, województwa i sezonu. Dane LEK/LDEK są celowo pominięte w
tym modelu. Pozostają cechami eksperymentalnych wariantów modelu progu.

Walidacja modelu zapełnienia jest typu rolling-origin. Każda historyczna runda
jest przewidywana przez model uczony wyłącznie na wcześniejszych rundach.
Backtest obejmuje 1712 obserwacji. Produkcyjny wynik regresji logistycznej ma
Brier score `0,1035`, AUC `0,9211` i ECE dla 10 przedziałów `0,0446`, wobec
Brier score `0,1921` dla wcześniejszej wygładzonej heurystyki historycznej.

Sprawdzono skalowanie Platta oraz monotoniczną kalibrację przedziałową na
prognozach cross-fitted. Kalibracja monotoniczna uzyskała Brier score `0,1051`
i ECE `0,0471`, czyli pogorszyła oba kryteria względem surowego modelu.
Dlatego:

- `prawdopodobienstwo_pelnej_puli` jest wybranym produkcyjnym wynikiem surowym;
- `prawdopodobienstwo_pelnej_puli_skalibrowane_eksperymentalne` pozostaje w CSV
  tylko do dalszych porównań;
- nowe metody kalibracji należy akceptować dopiero po poprawie rolling-origin
  Brier score i błędu kalibracji, bez korzystania z wyniku ocenianej rundy.

Plik `threshold_model_report.json` zapisuje konfigurację, metryki łączne,
wyniki według rund i punkty eksperymentalnego kalibratora.

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

Prognoza krajowa powstaje przez agregację prognoz regionalnych dla wszystkich
województw z ofertą. Porównywane są wagi z wygładzonej historii pełnych pul oraz
z osobnego modelu zapełnienia. Najniższe MAE na małym zbiorze konkurencyjnym ma
ensemble regionalny ważony historyczną szansą pełnej puli: `1,274` pkt wobec
`1,365` dla poprzedniego wariantu bazowego. Waga z modelu zapełnienia daje dla
ensemble `1,301` pkt, dlatego nie zastępuje prostszej wagi historycznej.
Backtest krajowy ocenia wyłącznie tury z co
najmniej trzema regionami z ofertą, trzema pełnymi pulami i 80% udziałem pełnych
pul. Jest to warunkowy,
stosunkowo mały zbiór. Dokładność dla rzadkich albo słabo obsadzanych
specjalizacji pozostaje nieznana; `zakres_oceny` w prognozie zaznacza, które
specjalizacje mają szerszą historię.

Kolumna `prognoza_krajowa_proc` wskazuje ten wariant: ensemble regionalny
ważony historyczną szansą pełnej puli. Pozostałe warianty pozostają w CSV do
porównania. Poprawa wystąpiła w trzech z czterech testowanych rund krajowych;
wiosną 2026 ensemble był gorszy. Wynik `1,274` należy więc traktować jako
obiecujący, ale jeszcze nie niezależnie potwierdzony.

Grupa `A_stabilny_pilotaz` wymaga co najmniej pięciu rund z ofertą, czterech rund
z pełnym obsadzeniem, udziału pełnych rund co najmniej 70%, mediany co najmniej
trzech zakwalifikowanych i mediany progu co najmniej 75%. Grupa
`B_wysoki_prog_mala_pula` obejmuje mniejsze, ale regularnie pełne pule z medianą
progu co najmniej 85%. Są to jawne reguły selekcji do testów, a nie wynik modelu.
