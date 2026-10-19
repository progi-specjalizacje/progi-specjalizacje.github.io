#!/usr/bin/env python3
"""Parse CMKP aggregate place-count PDFs into one normalized CSV."""

from __future__ import annotations

import csv
import json
import re
import unicodedata
from difflib import SequenceMatcher
from pathlib import Path

import pdfplumber


HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PDF_DIR = HERE / "pdfs"
RANKING_DIR = ROOT / "source_data"
OUTPUT_DIR = RANKING_DIR
OUTPUT_FILE = OUTPUT_DIR / "cmkp_places.csv"
QUALITY_FILE = HERE / "cmkp_places_quality_report.json"

ROUND_RE = re.compile(r"^([wj])-\d{4}\.pdf$")
PROVINCE_RE = re.compile(r"^Wojew.dztwo\s+(.+)$", re.IGNORECASE)
PLACE_ROW_RE = re.compile(r"^(.+?)\s+(\d+)\s+\((\d+)\)\s+(\d+)$")


def normalize(value: str) -> str:
    value = value.lower().replace("�", "")
    value = "".join(
        character
        for character in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(character)
    )
    return re.sub(r"[^a-z0-9]", "", value)


def load_canonical_values(column: str) -> list[str]:
    values: set[str] = set()
    for csv_path in sorted(RANKING_DIR.glob("[wj]-*_parsed.csv")):
        with csv_path.open(encoding="utf-8-sig", newline="") as stream:
            for row in csv.DictReader(stream):
                if row.get(column):
                    values.add(row[column].strip())
    return sorted(values)


def best_match(raw_value: str, candidates: list[str]) -> tuple[str, float, float]:
    normalized_raw = normalize(raw_value)
    scores = sorted(
        (
            (SequenceMatcher(None, normalized_raw, normalize(candidate)).ratio(), candidate)
            for candidate in candidates
        ),
        reverse=True,
    )
    best_score, best_candidate = scores[0]
    second_score = scores[1][0] if len(scores) > 1 else 0.0
    return best_candidate, best_score, best_score - second_score


def extract_rows(pdf_path: Path, provinces: list[str], specialties: list[str]) -> tuple[list[dict], list[dict]]:
    recruitment = pdf_path.stem
    current_province = ""
    rows: list[dict] = []
    issues: list[dict] = []

    with pdfplumber.open(pdf_path) as document:
        for page_number, page in enumerate(document.pages, start=1):
            text = page.extract_text(x_tolerance=1, y_tolerance=3) or ""
            for raw_line in text.splitlines():
                line = " ".join(raw_line.strip().split())
                if not line:
                    continue

                province_match = PROVINCE_RE.match(line)
                if province_match:
                    province, score, margin = best_match(province_match.group(1), provinces)
                    if score < 0.72 or margin < 0.05:
                        issues.append(
                            {
                                "type": "province_low_confidence",
                                "round": recruitment,
                                "page": page_number,
                                "raw": province_match.group(1),
                                "match": province,
                                "score": round(score, 4),
                                "margin": round(margin, 4),
                            }
                        )
                    current_province = province
                    continue

                row_match = PLACE_ROW_RE.match(line)
                if not row_match:
                    continue
                if not current_province:
                    issues.append(
                        {
                            "type": "row_without_province",
                            "round": recruitment,
                            "page": page_number,
                            "raw": line,
                        }
                    )
                    continue

                raw_specialty, residency, doctoral, non_residency = row_match.groups()
                if normalize(raw_specialty) == "suma":
                    continue
                specialty, score, margin = best_match(raw_specialty, specialties)
                if score < 0.72 or margin < 0.035:
                    issues.append(
                        {
                            "type": "specialty_low_confidence",
                            "round": recruitment,
                            "page": page_number,
                            "raw": raw_specialty,
                            "match": specialty,
                            "score": round(score, 4),
                            "margin": round(margin, 4),
                        }
                    )

                rows.append(
                    {
                        "rekrutacja": recruitment,
                        "wojewodztwo": current_province,
                        "dziedzina_medycyny": specialty,
                        "miejsca_rezydenckie_lacznie": int(residency),
                        "miejsca_doktoranckie": int(doctoral),
                        "miejsca_rezydenckie_zwykle": int(residency) - int(doctoral),
                        "miejsca_pozarezydenckie": int(non_residency),
                        "source_page": page_number,
                        "source_specialty_text": raw_specialty,
                        "match_score": round(score, 4),
                    }
                )

    return rows, issues


def main() -> None:
    provinces = load_canonical_values("wojewodztwo")
    specialties = load_canonical_values("dziedzina_medycyny")
    # This specialty appears in supply lists even though no accepted candidate in
    # the available ranking CSVs has introduced it into the canonical dictionary.
    specialties = sorted(set(specialties) | {"Medycyna lotnicza"})
    pdf_files = sorted(path for path in PDF_DIR.glob("*.pdf") if ROUND_RE.match(path.name))
    if not pdf_files:
        raise FileNotFoundError(f"Nie znaleziono PDF-ów w {PDF_DIR}")

    all_rows: list[dict] = []
    all_issues: list[dict] = []
    rows_by_round: dict[str, int] = {}
    for pdf_path in pdf_files:
        rows, issues = extract_rows(pdf_path, provinces, specialties)
        all_rows.extend(rows)
        all_issues.extend(issues)
        rows_by_round[pdf_path.stem] = len(rows)

    duplicate_keys: list[dict] = []
    seen: dict[tuple[str, str, str], dict] = {}
    for row in all_rows:
        key = (row["rekrutacja"], row["wojewodztwo"], row["dziedzina_medycyny"])
        if key in seen:
            duplicate_keys.append(
                {
                    "rekrutacja": key[0],
                    "wojewodztwo": key[1],
                    "dziedzina_medycyny": key[2],
                    "pages": [seen[key]["source_page"], row["source_page"]],
                }
            )
        else:
            seen[key] = row

    output_columns = [
        "rekrutacja",
        "wojewodztwo",
        "dziedzina_medycyny",
        "miejsca_rezydenckie_lacznie",
        "miejsca_doktoranckie",
        "miejsca_rezydenckie_zwykle",
        "miejsca_pozarezydenckie",
        "source_page",
        "source_specialty_text",
        "match_score",
    ]
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with OUTPUT_FILE.open("w", encoding="utf-8", newline="") as stream:
        writer = csv.DictWriter(stream, fieldnames=output_columns)
        writer.writeheader()
        writer.writerows(all_rows)

    report = {
        "sources": [str(path.relative_to(ROOT)).replace("\\", "/") for path in pdf_files],
        "counts": {
            "rows": len(all_rows),
            "rows_by_round": rows_by_round,
            "provinces": len({row["wojewodztwo"] for row in all_rows}),
            "specialties": len({row["dziedzina_medycyny"] for row in all_rows}),
            "low_confidence_matches": len(all_issues),
            "duplicate_keys": len(duplicate_keys),
            "negative_regular_place_counts": sum(
                row["miejsca_rezydenckie_zwykle"] < 0 for row in all_rows
            ),
        },
        "issues": all_issues,
        "duplicate_keys": duplicate_keys,
    }
    QUALITY_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Zapisano {len(all_rows)} wierszy do {OUTPUT_FILE.relative_to(ROOT)}.")
    print(f"Niejednoznaczne dopasowania: {len(all_issues)}; duplikaty kluczy: {len(duplicate_keys)}.")


if __name__ == "__main__":
    main()
