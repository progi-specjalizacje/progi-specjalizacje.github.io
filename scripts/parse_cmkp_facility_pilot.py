#!/usr/bin/env python3
"""Parse a nine-document CMKP facility pilot without changing model inputs."""

from __future__ import annotations

import csv
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from pathlib import Path

import pdfplumber


ROOT = Path(__file__).resolve().parent.parent
MANIFEST_FILE = ROOT / "prediction" / "sources" / "cmkp_facility_pilot_manifest.json"
PDF_DIR = ROOT / "prediction" / "sources" / "cmkp_facility_pdfs"
AGGREGATE_FILE = ROOT / "prediction" / "data" / "cmkp_places.csv"
OUTPUT_FILE = ROOT / "prediction" / "data" / "cmkp_facility_pilot.csv"
REPORT_FILE = ROOT / "prediction" / "data" / "cmkp_facility_pilot_report.json"
RANKING_DIR = ROOT / "source_data"

POSTCODE_RE = re.compile(r"(?<!\d)(\d{2})\s*-\s*(\d{3})(?!\d)")
INTEGER_RE = re.compile(r"^\s*(\d+)\s*$")
HEADING_RE = re.compile(r"^\s*\d+\s*[.)]\s*(.+?)\s*$")
STREET_MARKER_RE = re.compile(
    r"\s+(?:ul\.?|al\.?|aleja|os\.?|osiedle|pl\.?|plac|rynek)\s+",
    re.IGNORECASE,
)


def normalize(value: str) -> str:
    value = value.lower().replace("ł", "l").replace("�", "")
    value = "".join(
        character
        for character in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]", "", value)


def slug(value: str) -> str:
    value = "".join(
        character
        for character in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")


def compact(value: str | None) -> str:
    return " ".join((value or "").replace("\x02", " ").split())


def load_specialties() -> list[str]:
    values: set[str] = {"Medycyna lotnicza"}
    for csv_path in sorted(RANKING_DIR.glob("[wj]-*_parsed.csv")):
        with csv_path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                value = row.get("dziedzina_medycyny", "").strip()
                if value:
                    values.add(value)
    return sorted(values)


def best_match(raw_value: str, candidates: list[str]) -> tuple[str, float, float]:
    raw = normalize(raw_value)
    scores = sorted(
        (
            (SequenceMatcher(None, raw, normalize(candidate)).ratio(), candidate)
            for candidate in candidates
        ),
        reverse=True,
    )
    best_score, best = scores[0]
    second = scores[1][0] if len(scores) > 1 else 0.0
    return best, best_score, best_score - second


def extract_city(address: str) -> tuple[str, str, bool]:
    repaired = re.sub(r"(\d{2})\s*-\s*(?:\n|\r\n?)\s*(\d{3})", r"\1-\2", address)
    match = POSTCODE_RE.search(repaired)
    if not match:
        return "", "", False

    postcode = f"{match.group(1)}-{match.group(2)}"
    tail = repaired[match.end() :].lstrip(" ,;\n")
    tail = tail.replace("\r", "\n")
    first_line = next((line.strip() for line in tail.split("\n") if line.strip()), "")
    first_line = first_line.split(",", 1)[0].strip(" ()")
    street = STREET_MARKER_RE.search(first_line)
    if street:
        first_line = first_line[: street.start()].strip()
    first_line = re.sub(r"\s+\d+[A-Za-z]?([/-]\d+[A-Za-z]?)?.*$", "", first_line).strip()
    valid = bool(first_line) and not normalize(first_line).startswith(("ul", "aleja", "al", "osiedle"))
    return postcode, first_line if valid else "", "�" in first_line


def heading_above(
    page, table_bbox: tuple[float, float, float, float], specialties: list[str]
) -> str:
    top = table_bbox[1]
    text = page.crop((0, max(0, top - 38), page.width, top)).extract_text() or ""
    for line in reversed(text.splitlines()):
        candidate = compact(line)
        numbered = HEADING_RE.match(candidate)
        if numbered:
            candidate = numbered.group(1)
        if not candidate or POSTCODE_RE.search(candidate):
            continue
        _, score, margin = best_match(candidate, specialties)
        if score >= 0.72 and margin >= 0.035:
            return candidate
    return ""


def header_indexes(rows: list[list[str | None]]) -> dict[str, int]:
    indexes: dict[str, int] = {}
    for row in rows[:4]:
        for index, cell in enumerate(row):
            key = normalize(compact(cell))
            if "adres" in key:
                indexes["address"] = index
            if "liczba" in key and ("woln" in key or "miejsc" in key):
                indexes["capacity"] = index
            if "dziedzina" in key:
                indexes["specialty"] = index
            if "nazwaplacowki" in key:
                indexes["facility"] = index
            elif "nazwajednostki" in key and "facility" not in indexes:
                indexes["facility"] = index
            if "nazwajednostkinadrzednej" in key:
                indexes["parent"] = index
    return indexes


def fallback_indexes(column_count: int) -> dict[str, int]:
    if column_count >= 5:
        return {"facility": 0, "parent": 1, "address": 2, "specialty": 3, "capacity": 4}
    if column_count == 4:
        return {"facility": 1, "address": 2, "capacity": 3}
    return {"facility": 0, "address": 1, "capacity": 2}


def parse_source(source: dict, specialties: list[str]) -> tuple[list[dict], dict]:
    file_name = f"{source['rekrutacja']}_{slug(source['wojewodztwo'])}.pdf"
    path = PDF_DIR / file_name
    rows: list[dict] = []
    stats = Counter()
    specialty_scores: list[float] = []
    document_indexes: dict[str, int] = {}
    current_heading = ""

    with pdfplumber.open(path) as document:
        stats["pages"] = len(document.pages)
        for page_number, page in enumerate(document.pages, start=1):
            for table_number, table in enumerate(page.find_tables(), start=1):
                stats["tables"] += 1
                extracted = table.extract()
                if not extracted:
                    continue
                column_count = max(len(row) for row in extracted)
                indexes = fallback_indexes(column_count)
                indexes.update(document_indexes)
                detected_indexes = header_indexes(extracted)
                if detected_indexes:
                    document_indexes.update(detected_indexes)
                    indexes.update(detected_indexes)
                detected_heading = heading_above(page, table.bbox, specialties)
                if detected_heading:
                    current_heading = detected_heading
                raw_heading = current_heading

                for table_row, cells in enumerate(extracted, start=1):
                    padded = list(cells) + [None] * (column_count - len(cells))
                    address = padded[indexes["address"]] if indexes["address"] < len(padded) else None
                    capacity_text = padded[indexes["capacity"]] if indexes["capacity"] < len(padded) else None
                    capacity_match = INTEGER_RE.match(compact(capacity_text))
                    if not capacity_match or not POSTCODE_RE.search(address or ""):
                        continue

                    stats["candidate_rows"] += 1
                    raw_specialty = (
                        compact(padded[indexes["specialty"]])
                        if "specialty" in indexes and indexes["specialty"] < len(padded)
                        else compact(raw_heading)
                    )
                    if not raw_specialty:
                        stats["missing_specialty"] += 1
                        specialty = ""
                        score = margin = 0.0
                    else:
                        specialty, score, margin = best_match(raw_specialty, specialties)
                        specialty_scores.append(score)
                        if score < 0.72 or margin < 0.035:
                            stats["low_confidence_specialty"] += 1

                    postcode, city, garbled_city = extract_city(address or "")
                    if city:
                        stats["city_extracted"] += 1
                    else:
                        stats["missing_city"] += 1
                    if garbled_city:
                        stats["garbled_city"] += 1

                    capacity = int(capacity_match.group(1))
                    if capacity > 0:
                        stats["positive_rows"] += 1
                        stats["positive_capacity"] += capacity
                    facility = compact(padded[indexes["facility"]]) if indexes["facility"] < len(padded) else ""
                    parent = (
                        compact(padded[indexes["parent"]])
                        if "parent" in indexes and indexes["parent"] < len(padded)
                        else ""
                    )
                    rows.append(
                        {
                            "rekrutacja": source["rekrutacja"],
                            "wojewodztwo": source["wojewodztwo"],
                            "dziedzina_medycyny": specialty,
                            "liczba_wolnych_miejsc": capacity,
                            "kod_pocztowy": postcode,
                            "miasto_raw": city,
                            "miasto_match_key": normalize(city),
                            "nazwa_placowki": facility,
                            "nazwa_jednostki_nadrzednej": parent,
                            "adres_raw": compact(address),
                            "source_page": page_number,
                            "source_table": table_number,
                            "source_row": table_row,
                            "source_specialty_text": raw_specialty,
                            "specialty_match_score": round(score, 4),
                            "specialty_match_margin": round(margin, 4),
                            "city_has_broken_glyph": int(garbled_city),
                            "source_url": source["url"],
                        }
                    )

    stats["rows"] = len(rows)
    stats["city_extraction_rate"] = round(stats["city_extracted"] / len(rows), 4) if rows else 0
    stats["garbled_city_rate"] = round(stats["garbled_city"] / len(rows), 4) if rows else 0
    stats["mean_specialty_match_score"] = (
        round(sum(specialty_scores) / len(specialty_scores), 4) if specialty_scores else 0
    )
    return rows, {
        "source_file": str(path.relative_to(ROOT)).replace("\\", "/"),
        "source_sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        **dict(stats),
    }


def load_aggregate() -> dict[tuple[str, str, str], int]:
    result: dict[tuple[str, str, str], int] = {}
    with AGGREGATE_FILE.open(encoding="utf-8-sig", newline="") as stream:
        for row in csv.DictReader(stream):
            key = (row["rekrutacja"], row["wojewodztwo"], row["dziedzina_medycyny"])
            result[key] = int(row["miejsca_rezydenckie_lacznie"]) + int(row["miejsca_pozarezydenckie"])
    return result


def build_reconciliation(rows: list[dict]) -> list[dict]:
    aggregate = load_aggregate()
    detailed: dict[tuple[str, str, str], int] = defaultdict(int)
    for row in rows:
        detailed[(row["rekrutacja"], row["wojewodztwo"], row["dziedzina_medycyny"])] += row[
            "liczba_wolnych_miejsc"
        ]

    comparisons = []
    for key, detailed_capacity in sorted(detailed.items()):
        if not key[2] or key not in aggregate:
            continue
        allocated = aggregate[key]
        comparisons.append(
            {
                "rekrutacja": key[0],
                "wojewodztwo": key[1],
                "dziedzina_medycyny": key[2],
                "detailed_available_capacity": detailed_capacity,
                "aggregate_allocated_places": allocated,
                "difference": detailed_capacity - allocated,
                "exact_match": detailed_capacity == allocated,
            }
        )
    return comparisons


def main() -> None:
    sources = json.loads(MANIFEST_FILE.read_text(encoding="utf-8"))
    specialties = load_specialties()
    all_rows: list[dict] = []
    source_reports = []
    for source in sources:
        rows, stats = parse_source(source, specialties)
        all_rows.extend(rows)
        source_reports.append({**source, **stats})

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    columns = list(all_rows[0])
    with OUTPUT_FILE.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader()
        writer.writerows(all_rows)

    reconciliation = build_reconciliation(all_rows)
    exact = sum(item["exact_match"] for item in reconciliation)
    physical_keys = Counter(
        (
            row["rekrutacja"],
            row["wojewodztwo"],
            row["dziedzina_medycyny"],
            row["nazwa_placowki"],
            row["adres_raw"],
            row["liczba_wolnych_miejsc"],
        )
        for row in all_rows
    )
    positive_capacity = sum(row["liczba_wolnych_miejsc"] for row in all_rows)
    located_positive_capacity = sum(
        row["liczba_wolnych_miejsc"] for row in all_rows if row["miasto_raw"]
    )
    report = {
        "scope": {
            "documents": len(sources),
            "rounds": sorted({source["rekrutacja"] for source in sources}),
            "provinces": sorted({source["wojewodztwo"] for source in sources}),
            "production_model_unchanged": True,
        },
        "counts": {
            "rows": len(all_rows),
            "positive_rows": sum(row["liczba_wolnych_miejsc"] > 0 for row in all_rows),
            "positive_capacity": positive_capacity,
            "positive_capacity_with_city": located_positive_capacity,
            "positive_capacity_city_coverage": round(
                located_positive_capacity / positive_capacity, 4
            ),
            "cities_extracted": sum(bool(row["miasto_raw"]) for row in all_rows),
            "city_extraction_rate": round(
                sum(bool(row["miasto_raw"]) for row in all_rows) / len(all_rows), 4
            ),
            "broken_city_glyph_rows": sum(row["city_has_broken_glyph"] for row in all_rows),
            "distinct_city_match_keys": len(
                {row["miasto_match_key"] for row in all_rows if row["miasto_match_key"]}
            ),
            "distinct_postcodes": len({row["kod_pocztowy"] for row in all_rows if row["kod_pocztowy"]}),
            "duplicate_physical_row_groups": sum(count > 1 for count in physical_keys.values()),
            "low_confidence_specialty_rows": sum(
                row["specialty_match_score"] < 0.72 or row["specialty_match_margin"] < 0.035
                for row in all_rows
            ),
        },
        "sources": source_reports,
        "reconciliation": {
            "compared_specialty_province_rounds": len(reconciliation),
            "exact_matches": exact,
            "exact_match_rate": round(exact / len(reconciliation), 4) if reconciliation else 0,
            "detailed_capacity_below_allocated": sum(item["difference"] < 0 for item in reconciliation),
            "detailed_capacity_above_allocated": sum(item["difference"] > 0 for item in reconciliation),
            "rows": reconciliation,
        },
        "interpretation": {
            "capacity_semantics": (
                "The provincial PDFs expose available training capacity. It must not be described as "
                "facility-level residency allocation unless exact reconciliation is established."
            ),
            "city_semantics": (
                "miasto_raw is the first locality following the first postal code in the address cell; "
                "broken PDF glyphs are retained and flagged for later dictionary normalization."
            ),
        },
    }
    REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Zapisano {len(all_rows)} wierszy do {OUTPUT_FILE.relative_to(ROOT)}.")
    print(
        f"Miasto wydobyto dla {report['counts']['cities_extracted']}/{len(all_rows)} wierszy; "
        f"dokładne uzgodnienia sum: {exact}/{len(reconciliation)}."
    )


if __name__ == "__main__":
    main()
