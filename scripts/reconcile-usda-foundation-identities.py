#!/usr/bin/env python3
"""ALL-228: offline, review-only USDA Foundation Foods ↔ V1 ingredient identity audit.

Reads only files. Never assigns canonical V2 IDs, imports nutrient values, or publishes.
Usage:
  python3 scripts/reconcile-usda-foundation-identities.py archive.zip \
    docs/evidence/ALL-228-V1-408-IDENTITY-CANDIDATE-SNAPSHOT-2026-11-12.json \
    /private/path/reconciliation.json
"""
import collections
import difflib
import hashlib
import json
import re
import sys
import unicodedata
import zipfile
from pathlib import Path
from urllib.parse import urlparse

EXPECTED_ZIP_SHA256 = "dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579"
EXPECTED_JSON_SHA256 = "990e7731dcec30cecbbb212896a0fe4333f38c65ce7f525e2b679f0dc27658a1"
MEMBER = "FoodData_Central_foundation_food_json_2026-10-29.json"
EXPECTED_USDA_COUNT = 424
EXPECTED_V1_COUNT = 408


def normalize(value):
    if not isinstance(value, str):
        return ""
    return " ".join(unicodedata.normalize("NFKC", value).casefold().strip().split())


def tokens(value):
    return frozenset(re.findall(r"[a-z0-9]+", normalize(value)))


def similarity(first, second):
    a, b = tokens(first), tokens(second)
    return len(a & b) / len(a | b) if a and b else 0


def inspect_archive(archive, expected_hash=EXPECTED_ZIP_SHA256,
                    expected_json_hash=EXPECTED_JSON_SHA256,
                    expected_count=EXPECTED_USDA_COUNT):
    source = Path(archive).read_bytes()
    if hashlib.sha256(source).hexdigest() != expected_hash:
        raise ValueError("USDA ZIP SHA-256 mismatch")
    with zipfile.ZipFile(archive) as zip_file:
        if zip_file.namelist() != [MEMBER]:
            raise ValueError("Unexpected USDA ZIP member list")
        if zip_file.testzip() is not None:
            raise ValueError("USDA ZIP CRC failure")
        payload = zip_file.read(MEMBER)
    if hashlib.sha256(payload).hexdigest() != expected_json_hash:
        raise ValueError("USDA JSON SHA-256 mismatch")
    result = json.loads(payload)
    if not isinstance(result, dict) or not isinstance(result.get("FoundationFoods"), list):
        raise ValueError("Missing FoundationFoods JSON array")
    foods = result["FoundationFoods"]
    ids = [food.get("fdcId") for food in foods]
    if (len(foods) != expected_count or len(set(ids)) != expected_count
            or any(not isinstance(fid, int) for fid in ids)
            or any(food.get("dataType") != "Foundation" or not food.get("description")
                   for food in foods)):
        raise ValueError("USDA Foundation identity inventory inconsistent")
    return foods


def reconcile(foods, profiles, expected_foods=EXPECTED_USDA_COUNT,
              expected_profiles=EXPECTED_V1_COUNT):
    if len(foods) != expected_foods or len(profiles) != expected_profiles:
        raise ValueError("Source row counts differ from pinned review snapshot")
    keys = [p.get("source_profile_key") for p in profiles]
    if any(not isinstance(key, str) or not key for key in keys) or len(set(keys)) != len(keys):
        raise ValueError("Missing or duplicated V1 source identity keys")
    ids = [food.get("fdcId") for food in foods]
    if len(set(ids)) != len(ids):
        raise ValueError("Duplicate USDA FDC IDs")
    # V1 stores exact FDC references predominantly inside source_url, rather
    # than source_fdc_id. Preserve those as explicit evidence requiring review.
    source_links = collections.defaultdict(set)
    conflicting_source_references = []
    for p in profiles:
        raw_id = p.get("source_fdc_id")
        url = p.get("source_url") or ""
        match = (re.search(r"/food-details/([0-9]+)(?:/|$)", url)
                 if isinstance(url, str) and urlparse(url).scheme == "https"
                 and urlparse(url).hostname == "fdc.nal.usda.gov" else None)
        # Boolean is an int in Python but is not a USDA ID. A text source
        # identity must be a bounded positive decimal, not a coerced guess.
        raw_value = (int(raw_id) if type(raw_id) is int and 0 < raw_id < 10**12
                     else int(raw_id) if isinstance(raw_id, str)
                     and re.fullmatch(r"[1-9][0-9]{0,11}", raw_id) else None)
        url_value = int(match.group(1)) if match else None
        if raw_value is not None and url_value is not None and raw_value != url_value:
            conflicting_source_references.append(p["source_profile_key"])
            continue
        fdc_id = raw_value if raw_value is not None else url_value
        if fdc_id is not None and 0 < fdc_id < 10**12:
            source_links[fdc_id].add(p["source_profile_key"])
    names = collections.defaultdict(set)
    for p in profiles:
        for value in [p.get("source_label")] + (p.get("source_aliases") or []):
            term = normalize(value)
            if term:
                names[term].add(p["source_profile_key"])
    entries = []
    matched_keys = set()
    for food in sorted(foods, key=lambda x: x["fdcId"]):
        fdc_id = food["fdcId"]
        description = food["description"]
        exact = sorted(names[normalize(description)])
        matched_keys.update(exact)
        direct_source = sorted(source_links.get(fdc_id, set()))
        suggested = []
        if not exact and not direct_source:
            for profile in profiles:
                variants = [profile.get("source_label")] + (profile.get("source_aliases") or [])
                best = max((similarity(description, text) for text in variants), default=0)
                if best >= 0.42:
                    suggested.append((round(best, 4), profile["source_profile_key"]))
            suggested.sort(key=lambda pair: (-pair[0], pair[1]))
        # A matching FDC source URL and a matching label may point to
        # different V1 source profiles. Surface that disagreement for a
        # human reviewer; never let source priority hide conflicting evidence.
        disagreement = bool(direct_source and exact
                            and set(direct_source).isdisjoint(exact))
        status = ("source_fdc_reference_review" if direct_source else
                  "exact_name_review" if exact else
                  "similar_name_review" if suggested else "no_candidate")
        entries.append({
            "fdcId": fdc_id,
            "description": description,
            "source_data_type": food.get("dataType"),
            "status": status,
            "identity_evidence_disagreement": disagreement,
            "identity_evidence_disagreement_requires_review": disagreement,
            "exact_source_profile_keys": exact,
            "direct_fdc_source_profile_keys": direct_source,
            "suggestions": [
                {"source_profile_key": key, "token_jaccard": score}
                for score, key in suggested[:3]
            ],
            "canonical_identity_approved": False,
            "nutrient_profile_approved": False,
        })
    distribution = dict(sorted(collections.Counter(e["status"] for e in entries).items()))
    return {
        "policy": "review_only_no_automatic_identity_merges_no_nutrition_import",
        "publicationApproved": False,
        "calculationReady": False,
        "conflictingV1SourceReferenceKeys": sorted(conflicting_source_references),
        "reconciliationApproved": False,
        "sourceCount": {"usdaFoundation": len(foods), "v1Profiles": len(profiles)},
        "summary": {
            "usdaStatusCounts": distribution,
            "exactNameLinkedV1ProfileCount": len(matched_keys),
            "v1ProfileCountWithoutExactName": len(profiles) - len(matched_keys),
            "exactNameCandidatePairs": sum(len(e["exact_source_profile_keys"]) for e in entries),
            "directFdcSourceReferencePairs": sum(len(e["direct_fdc_source_profile_keys"]) for e in entries),
            "directFdcLinkedV1Profiles": len(set(
                key for e in entries for key in e["direct_fdc_source_profile_keys"])),
            "sourceVsExactAliasDisagreements": sum(
                bool(e["identity_evidence_disagreement"]) for e in entries),
            "conflictingV1SourceReferenceProfiles": len(conflicting_source_references),
        },
        "method": "Unicode NFKC casefold whitespace exact label/alias; fallback token Jaccard >=0.42 top 3 review suggestions. No inferred form, synonym or nutrient equivalence.",
        "rows": entries,
    }


def main(argv):
    if len(argv) != 4:
        raise ValueError("Usage: python3 reconcile-usda-foundation-identities.py zip snapshot.json output.json")
    _, archive, source_path, output_path = argv
    foods = inspect_archive(archive)
    snapshot = json.loads(Path(source_path).read_text(encoding="utf-8"))
    if snapshot.get("profileCount") != EXPECTED_V1_COUNT or snapshot.get("macroFactsIncluded") is not False:
        raise ValueError("Invalid macro-free V1 source identity snapshot")
    report = reconcile(foods, snapshot["profiles"])
    target = Path(output_path)
    if target.exists():
        raise ValueError("Refusing to overwrite existing reconciliation review")
    target.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], indent=2))


if __name__ == "__main__":
    try:
        main(sys.argv)
    except Exception as error:
        print(f"USDA identity reconciliation rejected: {error}", file=sys.stderr)
        sys.exit(1)
