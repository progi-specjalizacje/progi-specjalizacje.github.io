#!/usr/bin/env python3
"""Parser list rankingowych SMK z plików PDF do CSV."""

from __future__ import annotations

import argparse
import csv
import re
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Iterable


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_INPUT_DIR = SCRIPT_DIR / "pdfs"
# Gotowe CSV trafiają bezpośrednio do danych strony.
DEFAULT_OUTPUT_DIR = SCRIPT_DIR.parent.parent / "source_data"


HEADER_PUBLICATION_DATE_RE = re.compile(r"^Data publikacji w systemie\s+(\d{2}\.\d{2}\.\d{4})$")
HEADER_PRINT_RE = re.compile(
    r"Data wydruku\s+(\d{2}\.\d{2}\.\d{4}\s+\d{2}:\d{2}:\d{2})\s+Strona\s+(\d+)\s+z\s+(\d+)"
)
DOCTORAL_VOIVODESHIP_RE = re.compile(r"^Wojew.dztwo\s+(.+?)\s+-\s+Miejsca doktoranckie$")
VOIVODESHIP_RE = re.compile(r"^Wojew.dztwo\s+(.+)$")
DOCTORAL_TABLE_HEADER_RE = re.compile(
    r"^Lp\.\s+Dziedzina medycyny\s+Numer wniosku\s+Tryb szkolenia\s+Punktacja\s+.+?Data z.o.enia wniosku$"
)
ROW_RE = re.compile(
    r"^(\d+)\s+(.+?)\s+(\d{4}/\d{6})\s+([^\W\d_�]+)\s+"
    r"(\d+\.\d+)%\s+(\d+\.\d+)\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}:\d{2}:\d{2})$"
)
PDF_BOILERPLATE_MARKERS = (
    "Status dokumentu",
    "SMK System Monitorowania",
    "Pracowników Medycznych",
    "Dokument został utworzony",
)


@dataclass
class ParseContext:
    rekrutacja: str = ""
    publication_date: str = ""
    print_datetime: str = ""
    page: str = ""
    page_total: str = ""
    wojewodztwo: str = ""
    section: str = ""  # np. "Miejsca doktoranckie"
    doktoranckie_podmiot: str = ""
    doktoranckie_jednostka: str = ""
    pending_doctoral_location_lines: list[str] = field(default_factory=list)


def resolve_input_dir(input_dir: Path) -> Path:
    if input_dir.exists():
        return input_dir

    if DEFAULT_INPUT_DIR.exists():
        print(f"[INFO] Folder wejściowy nie istnieje, używam '{DEFAULT_INPUT_DIR}'.")
        return DEFAULT_INPUT_DIR

    raise FileNotFoundError(f"Nie znaleziono folderu wejściowego ani '{DEFAULT_INPUT_DIR}'.")


def normalize_pdf_line(line: str) -> str:
    collapsed_chars: list[str] = []
    duplicate_pairs = 0
    i = 0

    while i < len(line):
        if i + 1 < len(line) and line[i] == line[i + 1] and not line[i].isspace():
            collapsed_chars.append(line[i])
            duplicate_pairs += 1
            i += 2
        else:
            collapsed_chars.append(line[i])
            i += 1

    collapsed = "".join(collapsed_chars)
    if duplicate_pairs >= 5 and (
        collapsed.startswith("Województwo")
        or collapsed.startswith("Lp.")
        or "Miejsca doktoranckie" in collapsed
    ):
        return collapsed

    return line


def is_pdf_boilerplate_line(line: str) -> bool:
    if "Data wydruku" in line or HEADER_PUBLICATION_DATE_RE.match(line):
        return False

    return any(marker in line for marker in PDF_BOILERPLATE_MARKERS)


def extract_pdf_lines(path: Path) -> list[str]:
    try:
        import pdfplumber
    except ImportError as exc:
        raise RuntimeError(
            "Do parsowania PDF wymagany jest pakiet pdfplumber. "
            "Zainstaluj go poleceniem: python -m pip install pdfplumber"
        ) from exc

    lines: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages:
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            page_lines = [normalize_pdf_line(line.strip()) for line in text.splitlines() if line.strip()]
            print_line = next((line for line in page_lines if "Data wydruku" in line), "")

            if print_line:
                lines.append(print_line)

            lines.extend(
                line
                for line in page_lines
                if "Data wydruku" not in line and not is_pdf_boilerplate_line(line)
            )

    return lines


def extract_doctoral_location(location_lines: list[str]) -> tuple[str, str]:
    if not location_lines:
        return "", ""

    podmiot = location_lines[0]
    jednostka = " ".join(location_lines[1:]) if len(location_lines) > 1 else ""
    return podmiot, jednostka


def parse_file(path: Path) -> list[dict[str, str]]:
    if path.suffix.lower() != ".pdf":
        raise ValueError(f"Nieobsługiwany format pliku (oczekiwano .pdf): {path}")

    rows: list[dict[str, str]] = []
    ctx = ParseContext(rekrutacja=path.stem)

    for raw_line in extract_pdf_lines(path):
        line = raw_line.strip()
        if not line:
            continue

        pub_date_match = HEADER_PUBLICATION_DATE_RE.match(line)
        if pub_date_match:
            ctx.publication_date = pub_date_match.group(1)
            continue

        print_match = HEADER_PRINT_RE.search(line)
        if print_match:
            ctx.print_datetime = print_match.group(1)
            ctx.page = print_match.group(2)
            ctx.page_total = print_match.group(3)
            continue

        doctoral_voiv_match = DOCTORAL_VOIVODESHIP_RE.match(line)
        if doctoral_voiv_match:
            ctx.wojewodztwo = doctoral_voiv_match.group(1)
            ctx.section = "Miejsca doktoranckie"
            ctx.doktoranckie_podmiot = ""
            ctx.doktoranckie_jednostka = ""
            ctx.pending_doctoral_location_lines = []
            continue

        voiv_match = VOIVODESHIP_RE.match(line)
        if voiv_match:
            ctx.wojewodztwo = voiv_match.group(1)
            ctx.section = ""
            ctx.doktoranckie_podmiot = ""
            ctx.doktoranckie_jednostka = ""
            ctx.pending_doctoral_location_lines = []
            continue

        if line == "Miejsca doktoranckie":
            ctx.section = line
            ctx.doktoranckie_podmiot = ""
            ctx.doktoranckie_jednostka = ""
            ctx.pending_doctoral_location_lines = []
            continue

        if ctx.section == "Miejsca doktoranckie" and DOCTORAL_TABLE_HEADER_RE.match(line):
            if ctx.pending_doctoral_location_lines:
                ctx.doktoranckie_podmiot, ctx.doktoranckie_jednostka = extract_doctoral_location(
                    ctx.pending_doctoral_location_lines
                )
                ctx.pending_doctoral_location_lines = []
            continue

        row_match = ROW_RE.match(line)
        if row_match:
            lp, dziedzina, numer_wniosku, tryb, punktacja, srednia, data, godzina = row_match.groups()
            rows.append(
                {
                    "rekrutacja": ctx.rekrutacja,
                    "kolejność_plików": "",
                    "publication_date": ctx.publication_date,
                    "print_datetime": ctx.print_datetime,
                    "page": ctx.page,
                    "page_total": ctx.page_total,
                    "wojewodztwo": ctx.wojewodztwo,
                    "lp": lp,
                    "dziedzina_medycyny": dziedzina,
                    "numer_wniosku": numer_wniosku,
                    "tryb_szkolenia": tryb,
                    "punktacja_proc": punktacja,
                    "srednia_arytmetyczna": srednia,
                    "data_zlozenia_wniosku": f"{data} {godzina}",
                    "ilość_zakwalifikowanych_w_trybie": "",
                    "czy_miejsca_doktoranckie": "TAK" if ctx.section == "Miejsca doktoranckie" else "NIE",
                    "doktoranckie_podmiot": ctx.doktoranckie_podmiot if ctx.section == "Miejsca doktoranckie" else "",
                    "doktoranckie_jednostka": ctx.doktoranckie_jednostka if ctx.section == "Miejsca doktoranckie" else "",
                }
            )
            continue

        if ctx.section == "Miejsca doktoranckie":
            ctx.pending_doctoral_location_lines.append(line)

    if ctx.publication_date:
        for row in rows:
            if not row.get("publication_date"):
                row["publication_date"] = ctx.publication_date

    return rows


def parse_all(files: Iterable[Path]) -> list[dict[str, str]]:
    all_rows: list[dict[str, str]] = []
    for path in sorted(files):
        parsed = parse_file(path)
        print(f"[INFO] {path.name}: sparsowano {len(parsed)} rekordów")
        all_rows.extend(parsed)
    return all_rows


def parse_publication_date(publication_date: str) -> datetime:
    if not publication_date:
        raise ValueError("Brak wartości 'publication_date' - nie można wyliczyć pól zależnych od daty publikacji.")

    cleaned = publication_date.strip()
    if re.fullmatch(r"\d{8}", cleaned):
        return datetime.strptime(cleaned, "%Y%m%d")

    for fmt in ("%d.%m.%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(cleaned, fmt)
        except ValueError:
            continue

    raise ValueError(
        f"Nieprawidłowa wartość 'publication_date': {publication_date!r}. "
        "Oczekiwany format to DD.MM.RRRR lub RRRR-MM-DD."
    )


def publication_date_to_kolejnosc_plikow(publication_date: str) -> str:
    return parse_publication_date(publication_date).strftime("%Y%m%d")


def publication_date_to_rekrutacja(publication_date: str) -> str:
    parsed_date = parse_publication_date(publication_date)
    prefix = "w" if 2 <= parsed_date.month <= 7 else "j"
    return f"{prefix}-{parsed_date.year}"


def fill_rekrutacja_from_publication_date(rows: list[dict[str, str]]) -> None:
    for row in rows:
        row["rekrutacja"] = publication_date_to_rekrutacja(row["publication_date"])


def fill_kolejnosc_plikow_from_publication_date(rows: list[dict[str, str]]) -> None:
    for row in rows:
        row["kolejność_plików"] = publication_date_to_kolejnosc_plikow(row["publication_date"])

def add_ilosc_zakwalifikowanych_w_trybie(rows: list[dict[str, str]]) -> None:
    counts = Counter(
        (
            row["wojewodztwo"],
            row["dziedzina_medycyny"],
            row["tryb_szkolenia"],
            row["czy_miejsca_doktoranckie"],
        )
        for row in rows
    )

    for row in rows:
        key = (
            row["wojewodztwo"],
            row["dziedzina_medycyny"],
            row["tryb_szkolenia"],
            row["czy_miejsca_doktoranckie"],
        )
        row["ilość_zakwalifikowanych_w_trybie"] = str(counts[key])


def save_csv(rows: list[dict[str, str]], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not rows:
        raise ValueError("Brak danych do zapisu - plik wyjściowy nie zostanie utworzony.")

    fieldnames = list(rows[0].keys())
    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def default_output_path_for_rows(rows: list[dict[str, str]]) -> Path:
    rekrutacja = next((row["rekrutacja"] for row in rows if row.get("rekrutacja")), "")
    if not rekrutacja:
        raise ValueError("Brak wartości 'rekrutacja' - nie można wyliczyć nazwy pliku wyjściowego.")

    return DEFAULT_OUTPUT_DIR / f"{rekrutacja}_parsed.csv"


def process_single_file(input_file: Path, output_path: Path | None = None) -> None:
    rows = parse_file(input_file)
    print(f"[INFO] {input_file.name}: sparsowano {len(rows)} rekordów")
    fill_rekrutacja_from_publication_date(rows)
    fill_kolejnosc_plikow_from_publication_date(rows)
    add_ilosc_zakwalifikowanych_w_trybie(rows)
    if output_path is None:
        output_path = default_output_path_for_rows(rows)
    save_csv(rows, output_path)
    print(f"[OK] Zapisano {len(rows)} rekordów do {output_path}")


def update_existing_csv(csv_path: Path) -> int:
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        if not fieldnames:
            return 0
        rows = list(reader)

    if not rows:
        return 0

    pub_col = next((c for c in fieldnames if c.lower() in ("publication_date", "publication date")), None)
    rekrutacja_col = next((c for c in fieldnames if c.lower() == "rekrutacja"), None)
    kolejnosc_col = next(
        (c for c in fieldnames if c.lower() in ("kolejność_plików", "kolejnosc_plikow", "kolejność plików", "kolejność plikow")),
        None,
    )

    if not pub_col:
        raise ValueError(f"W pliku {csv_path.name} nie znaleziono kolumny z datą publikacji ('publication_date').")
    if not rekrutacja_col:
        raise ValueError(f"W pliku {csv_path.name} nie znaleziono kolumny 'rekrutacja'.")
    if not kolejnosc_col:
        raise ValueError(f"W pliku {csv_path.name} nie znaleziono kolumny 'kolejność_plików'.")

    first_pub_date = next((r[pub_col] for r in rows if r.get(pub_col)), "")
    if not first_pub_date:
        raise ValueError(f"W pliku {csv_path.name} brak wartości w kolumnie '{pub_col}'.")

    rekrutacja_val = publication_date_to_rekrutacja(first_pub_date)
    kolejnosc_val = publication_date_to_kolejnosc_plikow(first_pub_date)
    for r in rows:
        r[rekrutacja_col] = rekrutacja_val
        r[kolejnosc_col] = kolejnosc_val

    with csv_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(
        f"[OK] Zaktualizowano {csv_path.name}: "
        f"rekrutacja = {rekrutacja_val}, kolejność_plików = {kolejnosc_val} ({len(rows)} wierszy)"
    )
    return len(rows)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Parsowanie list rankingowych SMK (PDF) do tabeli CSV."
    )
    parser.add_argument(
        "--input-dir",
        type=Path,
        default=DEFAULT_INPUT_DIR,
        help="Folder z plikami .pdf (domyślnie: data_pipeline/results/pdfs)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Ścieżka pliku wyjściowego CSV (domyślnie: source_data/<runda>_parsed.csv dla każdego PDF-u)",
    )
    parser.add_argument(
        "--update-csv",
        type=Path,
        default=None,
        help=(
            "Ścieżka do pliku CSV lub folderu z plikami CSV do zaktualizowania kolumn "
            "'rekrutacja' i 'kolejność_plików' na podstawie 'publication_date'"
        ),
    )
    args = parser.parse_args()

    if args.update_csv is not None:
        target = args.update_csv
        if target.is_file():
            update_existing_csv(target)
        elif target.is_dir():
            csv_files = sorted(target.glob("*.csv"))
            if not csv_files:
                raise FileNotFoundError(f"Brak plików .csv w folderze: {target}")
            for cf in csv_files:
                update_existing_csv(cf)
        else:
            raise FileNotFoundError(f"Ścieżka nie istnieje: {target}")
        return

    input_dir = resolve_input_dir(args.input_dir)
    input_files = list(input_dir.glob("*.pdf"))
    if not input_files:
        raise FileNotFoundError(f"Brak plików .pdf w folderze: {input_dir}")

    sorted_input_files = sorted(input_files)
    if args.output is None:
        for input_file in sorted_input_files:
            process_single_file(input_file)
        return

    rows = parse_all(sorted_input_files)
    fill_rekrutacja_from_publication_date(rows)
    fill_kolejnosc_plikow_from_publication_date(rows)
    add_ilosc_zakwalifikowanych_w_trybie(rows)
    save_csv(rows, args.output)
    print(f"[OK] Zapisano {len(rows)} rekordów do {args.output}")


if __name__ == "__main__":
    main()
