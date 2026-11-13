"""No-network guards for ALL-228/225 temporary hosted acceptance harness."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]
S=ROOT/"scripts/test-v2-ingredient-hosted-eight-seed.py"
spec=importlib.util.spec_from_file_location("hosted_eight_seed",S)
hosted=importlib.util.module_from_spec(spec)
spec.loader.exec_module(hosted)

class HostedEightSeedSafety(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        evidence=json.loads(hosted.EVIDENCE.read_text("utf8"))
        aliases={x["source_profile_key"]:x for x in json.loads(hosted.ALIASES.read_text("utf8"))["records"]}
        digests={x["fdcId"]:x for x in json.loads(hosted.DIGESTS.read_text("utf8"))["records"]}
        cls.foods=[]
        for f in evidence["records"]:
            i=aliases[f["profile"]]
            cls.foods.append({"fdc":str(f["fdcId"]),"key":f["profile"],
               "name":i["display_name"],"state":i["preparation_state"],
               "description":f["source"],"digest":digests[f["fdcId"]]["sourcePayloadSha256"],
               "core":{"energy_kcal":f["energy"]["kcal"],"protein_g":f["protein"],
                       "carbohydrate_g":f["carbs"],"total_fat_g":f["fat"],
                       "sodium_mg":f["sodiumMg"]},
               "ids":{k:hosted.stable_id(k,f["profile"],f["fdcId"])
                      for k in ["request","ingredient","profile","source"]}})
    def test_eight_unique_stable_ids(self):
        self.assertEqual(len(self.foods),8)
        for category in ("request","ingredient","profile","source"):
            self.assertEqual(len({x["ids"][category] for x in self.foods}),8)
        self.assertEqual(len({x["fdc"] for x in self.foods}),8)

    def test_source_and_seed_queries_require_separate_login_and_roles(self):
        officer="allin_usda_source_temp_0123456789"
        worker="allin_ing_workload_temp_0123456789"
        source=hosted.source_sql(self.foods,officer)
        seeds=hosted.seed_sql(self.foods,worker)
        self.assertEqual(source.count("SELECT allin_private.v2_release_ingredient_source_core("),8)
        self.assertEqual(seeds.count("SELECT allin_private.v2_seed_ingredient_candidate("),8)
        self.assertIn("session_user::text",source)
        self.assertIn("session_user::text",seeds)
        self.assertNotIn("calculation_ready",seeds)
        self.assertIn("::jsonb",source)
        self.assertIn("::jsonb",seeds)

    def test_setup_is_temporary_and_never_creates_public_grants(self):
        sql=hosted.setup_sql(self.foods,"allin_usda_source_temp_0123456789",
            "allin_ing_workload_temp_0123456789","a"*64,"b"*64,"0123456789")
        self.assertIn("BEGIN;",sql)
        self.assertIn("COMMIT;",sql)
        self.assertIn("nonempty/stale canonical catalog",sql)
        self.assertIn("NOBYPASSRLS",sql)
        self.assertNotIn("GRANT allin_v2_ingredient_publisher",sql)
        self.assertNotIn("GRANT EXECUTE ON FUNCTION allin_private.v2_seed_ingredient_candidate",sql.split("CREATE ROLE allin_v2_ingredient_source_releaser")[0])

    def test_cleanup_disables_both_logins_and_removes_only_temp_objects(self):
        officer="allin_usda_source_temp_0123456789"
        worker="allin_ing_workload_temp_0123456789"
        sql=hosted.cleanup_sql(self.foods,officer,worker)
        self.assertIn("ALTER ROLE "+officer+" NOLOGIN PASSWORD NULL",sql)
        self.assertIn("ALTER ROLE "+worker+" NOLOGIN PASSWORD NULL",sql)
        self.assertIn("DROP ROLE IF EXISTS "+officer,sql)
        self.assertIn("DROP ROLE IF EXISTS "+worker,sql)
        self.assertIn("DELETE FROM public.v2_ingredient_profile_nutrients WHERE profile_id IN",sql)
        self.assertNotIn("DROP TABLE public.v2_",sql)
        self.assertNotIn("DROP SCHEMA public",sql)

    def test_readback_requires_40_values_8_ledgers_and_no_publication(self):
        sql=hosted.acceptance_sql(self.foods,"officer","worker")
        self.assertIn("public.v2_ingredient_profile_nutrients)=40",sql)
        self.assertIn("allin_private.v2_ingredient_seed_events)=8",sql)
        self.assertIn("allin_private.v2_ingredient_source_core_evidence)=8",sql)
        self.assertIn("review_status='calculation_ready'",sql)
        self.assertIn("failed_eight_seed",sql)

if __name__=="__main__":
    unittest.main()
