# Prognozowanie progów i zapełnienia miejsc

## Pilotaż danych placówkowych CMKP

Osobny, nieprodukcyjny pilotaż sprawdza możliwość wydobycia placówki, adresu,
miasta i liczby wolnych miejsc z wojewódzkich PDF-ów CMKP. Obejmuje trzy
województwa (`Dolnośląskie`, `Mazowieckie`, `Warmińsko-mazurskie`) i trzy rundy
(`j-2023`, `w-2026`, `j-2026`). Źródła są zapisane w
`prediction/sources/cmkp_facility_pilot_manifest.json`.

```bash
npm run prediction:download-facility-pilot
npm run prediction:facility-pilot
```

Parser generuje `prediction/data/cmkp_facility_pilot.csv` oraz raport jakości
`prediction/data/cmkp_facility_pilot_report.json`. Wyniki pilotażu nie są
dołączane do produkcyjnego datasetu modelu. Pole `liczba_wolnych_miejsc` oznacza
dostępną pojemność szkoleniową z listy wojewódzkiej, a nie potwierdzony przydział
miejsc rezydenckich do konkretnej placówki.

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
  obsadzenia miejsc jesienią 2026 dla specjalizacji i województw z ofertą.

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
