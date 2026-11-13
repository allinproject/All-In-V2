#!/usr/bin/env python3
"""ALL-228 source-only join of a cryptographically verified official USDA ZIP
to the existing canonical source-admission review. No database, HTTP, publishing,
credentials, migrations, files written or canonical IDs created.

Run: py -3 scripts/preview-v2-usda-verified-admission.py PATH_TO_OFFICIAL_ZIP

The adjacent official source verifier owns SHA-256 and per-food nutrient truth.
This adapter only transports verified source observations into the existing
Node reviewUsdaAdmission() policy. Never use this preview as a writer grant.
"""
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / "scripts" / "verify-v2-usda-eight-source-nutrients.py"
NODE_REVIEW = ROOT / "scripts" / "preview-v2-usda-archive-admission.cjs"
EVIDENCE = ROOT / "docs" / "evidence" / "ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json"
ENERGY = ROOT / "docs" / "evidence" / "ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json"
MAX_NODE_BYTES = 100_000
NUTRIENTS = frozenset((1003, 1004, 1005, 1093, 1008, 2047, 2048))


def module_verifier():
    spec = importlib.util.spec_from_file_location("all228_zip_verifier", VERIFIER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def preview_archive(path, *, runner=subprocess.run):
    verifier = module_verifier()
    # This verifies complete official ZIP bytes, all eight raw per-food SHA256
    # digests, exact source identity, units, amounts and energy policy values.
    verified = verifier.verify_archive(path)
    evidence = json.loads(EVIDENCE.read_text(encoding="utf8"))
    pinned = json.loads(ENERGY.read_text(encoding="utf8"))
    if len(verified) != 8 or len(evidence["records"]) != 8 or len(pinned["records"]) != 8:
        raise ValueError("Unexpected source inventory")
    if pinned["archiveSha256"] != verifier.ARCHIVE_SHA or evidence["archiveSha256"] != verifier.ARCHIVE_SHA:
        raise ValueError("Source manifest drift")
    with zipfile.ZipFile(path) as z:
        member = [i for i in z.infolist() if i.filename.lower().endswith(".json")][0]
        original = json.loads(z.read(member))
    indexed = {food["fdcId"]: food for food in original["FoundationFoods"]
               if isinstance(food, dict) and isinstance(food.get("fdcId"), int)}
    digests = {row["fdcId"]: row for row in pinned["records"]}
    foods = []
    for row in evidence["records"]:
        fdc = row["fdcId"]
        raw = indexed[fdc]
        # The verifier already checked exact full-row digest; this projection
        # intentionally preserves only policy-relevant nutrient observations.
        nutrients = [n for n in raw["foodNutrients"]
                     if isinstance(n, dict) and isinstance(n.get("nutrient"), dict)
                     and n["nutrient"].get("id") in NUTRIENTS]
        foods.append({
            "source_profile_key": row["profile"],
            "provider": "usda_fdc",
            "dataType": raw["dataType"],
            "fdcId": fdc,
            "source_description": raw["description"],
            "archive_sha256": verifier.ARCHIVE_SHA,
            "payload_sha256": digests[fdc]["sourcePayloadSha256"],
            "basis_quantity": 100, "basis_unit": "g",
            "foodNutrients": nutrients
        })
    data = json.dumps({"sourceFoods": foods}, separators=(",", ":"), ensure_ascii=False)
    if len(data.encode("utf8")) > MAX_NODE_BYTES:
        raise ValueError("Unexpectedly large verified source policy projection")
    command = ["node", str(NODE_REVIEW)]
    result = runner(command, input=data, capture_output=True, text=True, timeout=30, cwd=ROOT)
    if result.returncode:
        # The Node policy never outputs source rows. Avoid accidentally echoing
        # a raw payload if a future caller changes its stderr policy.
        raise RuntimeError("Existing USDA source admission policy refused the verified archive")
    output = json.loads(result.stdout)
    if (output.get("sourceCount") != 8 or output.get("status") != "review_stage_complete"
        or output.get("writerAuthorized") is not False or
        output.get("publicationApproved") is not False or
        output.get("calculationReady") is not False or
        output.get("passedPreflight") != 8):
        raise ValueError("USDA verified review-only admission incomplete")
    return output


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: preview-v2-usda-verified-admission.py OFFICIAL_FOUNDATION_ZIP", file=sys.stderr)
        sys.exit(2)
    try:
        result = preview_archive(Path(sys.argv[1]))
        print(json.dumps(result, indent=2))
    except (OSError, ValueError, KeyError, TypeError, RuntimeError,
            zipfile.BadZipFile, subprocess.TimeoutExpired) as exc:
        print("ALL-228 verified source admission: " + str(exc), file=sys.stderr)
        sys.exit(1)
