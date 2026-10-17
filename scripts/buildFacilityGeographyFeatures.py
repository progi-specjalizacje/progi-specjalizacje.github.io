#!/usr/bin/env python3
"""Build capacity-weighted geographic features from the CMKP facility pilot."""

from __future__ import annotations

import csv
import hashlib
import json
import math
import statistics
import unicodedata
from collections import defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FACILITY_FILE = ROOT / "prediction" / "data" / "cmkp_facility_pilot.csv"
GEONAMES_FILE = ROOT / "prediction" / "sources" / "geonames_postal" / "PL.txt"
CLASSIFICATION_FILE = ROOT / "prediction" / "sources" / "city_classification_pilot.json"
OUTPUT_FILE = ROOT / "prediction" / "data" / "cmkp_facility_geography_features.csv"
REPORT_FILE = ROOT / "prediction" / "data" / "cmkp_facility_geography_report.json"


def normalize(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value or "")
    return "".join(character for character in decomposed if not unicodedata.combining(character)).lower().replace("ł", "l").replace("-", "").replace(" ", "")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def haversine_km(first: tuple[float, float], second: tuple[float, float]) -> float:
    lat1, lon1 = map(math.radians, first)
    lat2, lon2 = map(math.radians, second)
    delta_lat = lat2 - lat1
    delta_lon = lon2 - lon1
    value = math.sin(delta_lat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(delta_lon / 2) ** 2
    return 6371.0088 * 2 * math.asin(math.sqrt(value))


def mean_coordinate(coordinates: list[tuple[float, float]]) -> tuple[float, float] | None:
    if not coordinates:
        return None
    return (
        statistics.fmean(value[0] for value in coordinates),
        statistics.fmean(value[1] for value in coordinates),
    )


def load_geonames() -> tuple[dict[str, list[dict]], dict[str, list[tuple[float, float]]]]:
    by_postcode: dict[str, list[dict]] = defaultdict(list)
    by_city: dict[str, list[tuple[float, float]]] = defaultdict(list)
    with GEONAMES_FILE.open("r", encoding="utf-8") as handle:
        for fields in csv.reader(handle, delimiter="\t"):
            if len(fields) < 12:
                continue
            try:
                latitude = float(fields[9])
                longitude = float(fields[10])
            except ValueError:
                continue
            record = {
                "place": fields[2],
                "place_key": normalize(fields[2]),
                "latitude": latitude,
                "longitude": longitude,
            }
            by_postcode[fields[1]].append(record)
            by_city[record["place_key"]].append((latitude, longitude))
    return by_postcode, by_city


def match_coordinate(
    postcode: str,
    city_key: str,
    by_postcode: dict[str, list[dict]],
    by_city: dict[str, list[tuple[float, float]]],
) -> tuple[tuple[float, float] | None, str]:
    candidates = by_postcode.get(postcode, [])
    exact = [row for row in candidates if row["place_key"] == city_key]
    if exact:
        return mean_coordinate([(row["latitude"], row["longitude"]) for row in exact]), "postcode_city"
    if city_key in by_city:
        return mean_coordinate(by_city[city_key]), "city"
    if candidates:
        return mean_coordinate([(row["latitude"], row["longitude"]) for row in candidates]), "postcode"
    return None, "unmatched"


def weighted_mean(rows: list[dict], field: str) -> float | None:
    covered = [row for row in rows if row[field] is not None]
    denominator = sum(row["capacity"] for row in covered)
    if denominator <= 0:
        return None
    return sum(row["capacity"] * row[field] for row in covered) / denominator


def rounded(value: float | None, digits: int = 6) -> str:
    return "" if value is None else str(round(value, digits))


with CLASSIFICATION_FILE.open("r", encoding="utf-8") as handle:
    classification = json.load(handle)

large_cities = {normalize(value) for value in classification["large_cities"]}
academic_cities = {normalize(value) for value in classification["academic_cities"]}
province_capitals = {
    province: normalize(city) for province, city in classification["province_capitals"].items()
}
by_postcode, by_city = load_geonames()
capital_coordinates = {
    province: mean_coordinate(by_city.get(city_key, []))
    for province, city_key in province_capitals.items()
}

groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
match_methods: dict[str, int] = defaultdict(int)
positive_rows = 0
with FACILITY_FILE.open("r", encoding="utf-8-sig", newline="") as handle:
    for row in csv.DictReader(handle):
        try:
            capacity = float(row["liczba_wolnych_miejsc"])
        except (TypeError, ValueError):
            continue
        if capacity <= 0:
            continue
        positive_rows += 1
        city_key = row["miasto_match_key"] or normalize(row["miasto_raw"])
        coordinate, method = match_coordinate(row["kod_pocztowy"], city_key, by_postcode, by_city)
        match_methods[method] += 1
        capital = capital_coordinates.get(row["wojewodztwo"])
        distance = haversine_km(coordinate, capital) if coordinate and capital else None
        groups[(row["rekrutacja"], row["wojewodztwo"], row["dziedzina_medycyny"])].append(
            {
                "capacity": capacity,
                "city_key": city_key,
                "facility": row["nazwa_placowki"],
                "is_large": 1.0 if city_key in large_cities else 0.0,
                "is_academic": 1.0 if city_key in academic_cities else 0.0,
                "is_capital": 1.0 if city_key == province_capitals.get(row["wojewodztwo"]) else 0.0,
                "distance": distance,
            }
        )

columns = [
    "rekrutacja",
    "wojewodztwo",
    "dziedzina_medycyny",
    "pojemnosc_placowek_lacznie",
    "pojemnosc_z_geografia",
    "pokrycie_geografii",
    "liczba_placowek_z_dodatnia_pojemnoscia",
    "liczba_miast",
    "udzial_pojemnosci_duze_miasta",
    "udzial_pojemnosci_miasta_akademickie",
    "udzial_pojemnosci_w_stolicy",
    "srednia_odleglosc_od_stolicy_km",
]
output_rows = []
for key, rows in sorted(groups.items()):
    total_capacity = sum(row["capacity"] for row in rows)
    covered_capacity = sum(row["capacity"] for row in rows if row["distance"] is not None)
    output_rows.append(
        {
            "rekrutacja": key[0],
            "wojewodztwo": key[1],
            "dziedzina_medycyny": key[2],
            "pojemnosc_placowek_lacznie": rounded(total_capacity, 2),
            "pojemnosc_z_geografia": rounded(covered_capacity, 2),
            "pokrycie_geografii": rounded(covered_capacity / total_capacity if total_capacity else None),
            "liczba_placowek_z_dodatnia_pojemnoscia": len({row["facility"] for row in rows}),
            "liczba_miast": len({row["city_key"] for row in rows if row["city_key"]}),
            "udzial_pojemnosci_duze_miasta": rounded(weighted_mean(rows, "is_large")),
            "udzial_pojemnosci_miasta_akademickie": rounded(weighted_mean(rows, "is_academic")),
            "udzial_pojemnosci_w_stolicy": rounded(weighted_mean(rows, "is_capital")),
            "srednia_odleglosc_od_stolicy_km": rounded(weighted_mean(rows, "distance"), 3),
        }
    )

OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
with OUTPUT_FILE.open("w", encoding="utf-8", newline="") as handle:
    writer = csv.DictWriter(handle, fieldnames=columns)
    writer.writeheader()
    writer.writerows(output_rows)

report = {
    "generated_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    "classification_version": classification["version"],
    "definitions": classification["definitions"],
    "sources": {
        "facility_file": str(FACILITY_FILE.relative_to(ROOT)).replace("\\", "/"),
        "facility_sha256": file_sha256(FACILITY_FILE),
        "geonames_file": str(GEONAMES_FILE.relative_to(ROOT)).replace("\\", "/"),
        "geonames_sha256": file_sha256(GEONAMES_FILE),
        "classification_file": str(CLASSIFICATION_FILE.relative_to(ROOT)).replace("\\", "/"),
        **classification["sources"],
    },
    "counts": {
        "positive_capacity_rows": positive_rows,
        "feature_groups": len(output_rows),
        "coordinate_match_methods": dict(sorted(match_methods.items())),
        "groups_with_at_least_95_percent_geography_coverage": sum(
            float(row["pokrycie_geografii"] or 0) >= 0.95 for row in output_rows
        ),
    },
    "limitations": [
        "Pojemność placówki opisuje dostępne miejsca szkoleniowe w wykazie wojewódzkim, a nie liczbę miejsc rezydenckich przyznanych w danej rundzie.",
        "Współrzędne GeoNames są centroidami kodów pocztowych lub miejscowości, nie dokładnymi współrzędnymi budynków.",
        "Definicja miasta akademickiego jest eksperymentalna i stała dla pilotażu; nie zależy od wyników rekrutacji, ale przed rozszerzeniem należy dodać daty obowiązywania statusu uczelni.",
        "Pilotaż obejmuje tylko województwa dolnośląskie, mazowieckie i warmińsko-mazurskie.",
    ],
}
REPORT_FILE.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Zapisano {len(output_rows)} grup do {OUTPUT_FILE.relative_to(ROOT)}.")
print(f"Pokrycie metod współrzędnych: {dict(sorted(match_methods.items()))}.")
