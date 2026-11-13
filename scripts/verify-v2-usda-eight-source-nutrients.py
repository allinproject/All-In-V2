#!/usr/bin/env python3
"""ALL-228 read-only verification of eight pinned Foundation foods against raw USDA ZIP.

Uses the existing ALL-228/225 review evidence as assertions, never as food
publication authorization. No network, database, source extraction or writes.
Run: python scripts/verify-v2-usda-eight-source-nutrients.py PATH_TO_OFFICIAL_ZIP
Run synthetic negative tests: python scripts/verify-v2-usda-eight-source-nutrients.py --self-test
"""
import hashlib
import json
import re
import sys
import unittest
import zipfile
from decimal import Decimal, InvalidOperation
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EVIDENCE = ROOT / "docs/evidence"
ARCHIVE_SHA = "dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579"
RECORDS = "ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json"
DIGESTS = "ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json"
# Official FDC foodNutrients[].nutrient.id and unitName (NOT nutrient.number).
FIELDS = {
    "protein": (1003, "g"),
    "fat": (1004, "g"),
    "carbs": (1005, "g"),
    "sodiumMg": (1093, "mg"),
}
MAX_ZIP = 12_000_000
MAX_JSON = 50_000_000


def require(ok, message):
    if not ok:
        raise ValueError(message)


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def food_digest(food):
    # Matches the recorded Python source digest algorithm, including float spellings.
    return sha256(json.dumps(food, sort_keys=True, ensure_ascii=False,
                            separators=(",", ":")).encode("utf-8"))


def numeric(value, label):
    require(not isinstance(value, bool) and isinstance(value, (float, int)),
            label + ": nonnumeric or missing")
    try:
        result = Decimal(str(value))
    except InvalidOperation as exc:
        raise ValueError(label + ": invalid nutrient") from exc
    require(result.is_finite() and result >= 0, label + ": invalid nutrient")
    return result


def verify_food(food, expected, selection):
    fdc = expected["fdcId"]
    require(food.get("fdcId") == fdc, str(fdc) + ": wrong source ID")
    require(food.get("dataType") == "Foundation", str(fdc) + ": wrong data type")
    require(food.get("description") == expected["source"],
            str(fdc) + ": description or preparation form differs")
    require(food_digest(food) == selection["sourcePayloadSha256"],
            str(fdc) + ": per-food USDA source digest differs")
    require(isinstance(food.get("foodNutrients"), list),
            str(fdc) + ": missing foodNutrients")
    selected_id = int(expected["energy"]["code"])
    require(selected_id == selection["selectedFdcNutrientId"] and
            expected["energy"]["kcal"] == selection["selectedEnergyKcal"],
            str(fdc) + ": selected energy policy disagreement")
    fields = dict(FIELDS)
    fields["energy_kcal"] = (selected_id, "kcal")
    checked = {}
    expected_values = {**{k: expected[k] for k in FIELDS},
                       "energy_kcal": expected["energy"]["kcal"]}
    for field, (nutrient_id, unit) in fields.items():
        matches = [n for n in food["foodNutrients"]
                   if isinstance(n, dict) and isinstance(n.get("nutrient"), dict)
                   and n["nutrient"].get("id") == nutrient_id]
        require(len(matches) == 1, str(fdc) + ": missing/duplicate nutrient ID " + str(nutrient_id))
        observed = matches[0]
        actual_unit = observed["nutrient"].get("unitName")
        require(isinstance(actual_unit, str) and actual_unit.strip().lower() == unit,
                str(fdc) + ": wrong nutrient unit for " + field)
        actual = numeric(observed.get("amount"), str(fdc) + " " + field)
        recorded = numeric(expected_values[field], str(fdc) + " expected " + field)
        require(actual == recorded, str(fdc) + ": nutrient amount mismatch for " + field)
        checked[field] = {"nutrientId": nutrient_id, "unit": unit,
                          "amount": str(actual)}
    if expected["energy"].get("alternative"):
        alternative = expected["energy"]["alternative"]
        alternatives = [n for n in food["foodNutrients"]
                        if isinstance(n, dict) and isinstance(n.get("nutrient"), dict)
                        and n["nutrient"].get("id") == int(alternative["code"])]
        require(len(alternatives) == 1 and
                alternatives[0]["nutrient"].get("unitName", "").strip().lower() == "kcal" and
                numeric(alternatives[0].get("amount"), str(fdc) + " alternative energy") ==
                numeric(alternative["kcal"], str(fdc) + " expected alternative energy"),
                str(fdc) + ": general-factor alternative differs")
    return {"fdcId": fdc, "sourceDigestVerified": True,
            "preparationStateDescriptionVerified": True, "nutrients": checked,
            "calculationReady": False, "publicationApproved": False}


def verify_records(root, evidence, digest_evidence):
    require(isinstance(root, dict) and isinstance(root.get("FoundationFoods"), list),
            "Expected FoundationFoods source array")
    require(len(evidence["records"]) == len(digest_evidence["records"]) == 8,
            "Expected exactly eight pinned sources")
    ids = [x["fdcId"] for x in evidence["records"]]
    require(len(set(ids)) == 8, "Repeated pinned source identity")
    pinned = {x["fdcId"]: x for x in digest_evidence["records"]}
    require(len(pinned) == 8 and set(ids) == set(pinned),
            "Source/energy evidence membership disagreement")
    observed = {}
    wanted = set(ids)
    for row in root["FoundationFoods"]:
        if isinstance(row, dict) and row.get("fdcId") in wanted:
            key = row["fdcId"]
            require(key not in observed, str(key) + ": duplicate USDA food ID")
            observed[key] = row
    require(set(observed) == wanted, "Pinned USDA source missing from FoundationFoods")
    return [verify_food(observed[r["fdcId"]], r, pinned[r["fdcId"]])
            for r in evidence["records"]]


def verify_archive(path):
    require(path.is_file() and 1000 < path.stat().st_size <= MAX_ZIP,
            "Official ZIP missing or exceeds bounded size")
    raw = path.read_bytes()
    require(sha256(raw) == ARCHIVE_SHA, "Pinned USDA release checksum mismatch")
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        require(0 < len(members) <= 40, "Unexpected ZIP member count")
        names = [m.filename for m in members]
        require(len(set(names)) == len(names), "Duplicate ZIP member")
        require(all(not name.startswith("/") and "\\" not in name and
                    ".." not in name.split("/") and not re.search(r"[\x00-\x1f]", name)
                    for name in names), "Unsafe ZIP member name")
        json_members = [m for m in members if m.filename.lower().endswith(".json")]
        require(len(json_members) == 1 and json_members[0].file_size <= MAX_JSON,
                "Unexpected USDA JSON member or excessive size")
        root = json.loads(archive.read(json_members[0]))
    evidence = json.loads((EVIDENCE / RECORDS).read_text(encoding="utf-8"))
    digests = json.loads((EVIDENCE / DIGESTS).read_text(encoding="utf-8"))
    require(evidence["archiveSha256"] == digests["archiveSha256"] == ARCHIVE_SHA,
            "Source evidence references a different archive")
    return verify_records(root, evidence, digests)


class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.food = {
            "fdcId": 99, "description": "Example raw food", "dataType": "Foundation",
            "foodNutrients": [
                {"amount": amount, "nutrient": {"id": nutrient, "unitName": unit}}
                for nutrient, unit, amount in [
                    (1003, "g", 1.5), (1004, "g", 0.2),
                    (1005, "g", 3.5), (1093, "mg", 7),
                    (1008, "kcal", 21)]
            ],
        }
        self.expected = {"fdcId": 99, "source": "Example raw food",
                         "protein": 1.5, "fat": 0.2, "carbs": 3.5,
                         "sodiumMg": 7, "energy": {"code": "1008", "kcal": 21}}
        self.selected = {"sourcePayloadSha256": food_digest(self.food),
                         "selectedFdcNutrientId": 1008, "selectedEnergyKcal": 21}

    def test_valid_exact_fields(self):
        self.assertEqual(len(verify_food(self.food, self.expected, self.selected)["nutrients"]), 5)

    def test_wrong_source_digest(self):
        self.selected["sourcePayloadSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "digest"):
            verify_food(self.food, self.expected, self.selected)

    def test_wrong_form(self):
        self.expected["source"] = "Example cooked food"
        with self.assertRaisesRegex(ValueError, "preparation"):
            verify_food(self.food, self.expected, self.selected)

    def test_missing_nutrient_id(self):
        self.food["foodNutrients"] = self.food["foodNutrients"][1:]
        self.selected["sourcePayloadSha256"] = food_digest(self.food)
        with self.assertRaisesRegex(ValueError, "1003"):
            verify_food(self.food, self.expected, self.selected)

    def test_wrong_unit(self):
        self.food["foodNutrients"][0]["nutrient"]["unitName"] = "mg"
        self.selected["sourcePayloadSha256"] = food_digest(self.food)
        with self.assertRaisesRegex(ValueError, "unit"):
            verify_food(self.food, self.expected, self.selected)

    def test_wrong_amount(self):
        self.expected["protein"] = 1.6
        with self.assertRaisesRegex(ValueError, "amount mismatch"):
            verify_food(self.food, self.expected, self.selected)

    def test_duplicate_nutrient(self):
        self.food["foodNutrients"].append(dict(self.food["foodNutrients"][0]))
        self.selected["sourcePayloadSha256"] = food_digest(self.food)
        with self.assertRaisesRegex(ValueError, "duplicate"):
            verify_food(self.food, self.expected, self.selected)


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        unittest.main(argv=[sys.argv[0]], verbosity=2)
    elif len(sys.argv) == 2:
        try:
            verified = verify_archive(Path(sys.argv[1]))
            print(json.dumps({"status": "verified_source_only_not_published",
                              "archiveSha256": ARCHIVE_SHA, "recordCount": len(verified),
                              "records": verified, "calculationReady": False,
                              "publicationApproved": False}, indent=2))
        except (OSError, ValueError, KeyError, TypeError, zipfile.BadZipFile) as exc:
            print("ALL-228 source nutrient verification FAILED: " + str(exc), file=sys.stderr)
            sys.exit(1)
    else:
        print("Usage: verifier.py <official pinned ZIP> | --self-test", file=sys.stderr)
        sys.exit(2)
