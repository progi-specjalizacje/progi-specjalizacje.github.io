# Wyniki rekrutacji jesień 2022 (j-2022)

PDF listy zakwalifikowanych CMKP i jego sparsowany CSV z dawnego repozytorium parsera
`cmkp_wyniki_parse`. Strona pokazuje rundy od `w-2023`, więc ten plik nigdy nie był w
`source_data/`. Przeniesiony tutaj, żeby `npm run data:parse-results` (który parsuje
wszystkie PDF-y z `data_pipeline/results/pdfs/`) nie dodał tej rundy do strony.

Aby dodać rundę do strony: przenieś `j-2022.pdf` do `data_pipeline/results/pdfs/` i uruchom
`npm run data:parse-results` (dla wykazu miejsc trzeba też dopisać rundę do manifestu).
