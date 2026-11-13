#!/usr/bin/env python3
"""ALL-228 source-only release-proposal tests: no network, DB or writer grants."""
import copy
import importlib.util
import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "all228_source_release", ROOT / "scripts/preview-v2-usda-verified-admission.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
EVIDENCE = ROOT / "docs/evidence"


class SourceReleasePreviewTests(unittest.TestCase):
    def setUp(self):
        self.foods = json.loads((EVIDENCE / "ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json").read_text())
        self.digests = json.loads((EVIDENCE / "ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json").read_text())
        self.verified = [
            {"fdcId": f["fdcId"], "sourceDigestVerified": True,
             "preparationStateDescriptionVerified": True,
             "nutrients": {
                 "protein": {"nutrientId": 1003}, "fat": {"nutrientId": 1004},
                 "carbs": {"nutrientId": 1005}, "sodiumMg": {"nutrientId": 1093},
                 "energy_kcal": {"nutrientId": int(f["energy"]["code"]),
                                  "amount": str(f["energy"]["kcal"])}
             }}
            for f in self.foods["records"]
        ]

    def preview(self, verified=None, foods=None, digests=None, archive=None):
        return module.preview_source_release_evidence(
            self.verified if verified is None else verified,
            self.foods if foods is None else foods,
            self.digests if digests is None else digests,
            archive_sha=self.foods["archiveSha256"] if archive is None else archive
        )

    def test_eight_source_fourteen_energy_observations_source_only(self):
        result = self.preview()
        self.assertEqual(result["recordCount"], 14)
        self.assertEqual(result["sourceFoodCount"], 8)
        self.assertEqual(result["status"], "verified_evidence_proposal_only")
        self.assertTrue(result["requiresControlledImmutableSourceRelease"])
        self.assertFalse(result["authorizedToWrite"])
        self.assertFalse(result["calculationReady"])
        self.assertFalse(result["publicationApproved"])
        self.assertTrue(all(not row["releaseAuthorized"] and row["sourceRecordUuid"] is None
                            and row["archiveSha256"] == self.foods["archiveSha256"]
                            for row in result["records"]))
        self.assertEqual(sum(row["fdcNutrientId"] == 1008 for row in result["records"]), 2)
        self.assertEqual(sum(row["fdcNutrientId"] == 2048 for row in result["records"]), 6)
        self.assertEqual(sum(row["fdcNutrientId"] == 2047 for row in result["records"]), 6)

    def test_missing_and_duplicate_food_rejected(self):
        with self.assertRaises(ValueError):
            self.preview(verified=self.verified[:7])
        changed = copy.deepcopy(self.verified)
        changed[1]["fdcId"] = changed[0]["fdcId"]
        with self.assertRaises(ValueError):
            self.preview(verified=changed)

    def test_unverified_source_digest_rejected(self):
        changed = copy.deepcopy(self.verified)
        changed[2]["sourceDigestVerified"] = False
        with self.assertRaises(ValueError):
            self.preview(verified=changed)

    def test_wrong_energy_id_amount_or_archive_rejected(self):
        changed = copy.deepcopy(self.verified)
        changed[0]["nutrients"]["energy_kcal"]["nutrientId"] = 2047
        with self.assertRaises(ValueError):
            self.preview(verified=changed)
        changed = copy.deepcopy(self.verified)
        changed[1]["nutrients"]["energy_kcal"]["amount"] = "900"
        with self.assertRaises(ValueError):
            self.preview(verified=changed)
        with self.assertRaises(ValueError):
            self.preview(archive="f" * 64)


if __name__ == "__main__":
    unittest.main()
