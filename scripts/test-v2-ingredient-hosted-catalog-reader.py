#!/usr/bin/env python3
"""ALL-228 independently authenticated hosted catalog-reader acceptance.

Only the preapproved fbtgknlxjyeqrxemskbl temporary project. Requires psql,
a trusted Supabase root CA file, and the temporary project's admin DB password.
Credentials are generated in memory, never printed or stored in files.
This is a one-shot credential/fixture test with mandatory cleanup in finally.
Never executes against production or publishes ingredients.
"""
import getpass
import importlib.util
import os
from pathlib import Path
import secrets
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
HELPER_PATH = ROOT / "scripts/test-v2-ingredient-temp-hosted-review.py"
spec = importlib.util.spec_from_file_location("all228_existing_hosted_db", HELPER_PATH)
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
db_call = helper.db_call
PROJECT = "fbtgknlxjyeqrxemskbl"
READER = "allin_v2_ingredient_catalog_reader"
I = "11111111-1111-4111-8111-111111111111"
P = "22222222-2222-4222-8222-222222222222"
S = "33333333-3333-4333-8333-333333333333"
FOOD_ID = "790577"
DIGEST_PATH = ROOT / "docs/evidence/ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json"


def sql_literal(s):
    return "'" + s.replace("'", "''") + "'"


def prepare_sql(login, secret, digest):
    # Exact fixed temporary UUIDs and trusted alphanumeric generated role/password.
    return f"""
BEGIN;
DO $pre$ BEGIN
 IF EXISTS (SELECT 1 FROM public.v2_ingredients) OR
    EXISTS (SELECT 1 FROM public.v2_ingredient_source_records) OR
    EXISTS (SELECT 1 FROM public.v2_ingredient_nutrition_profiles) OR
    EXISTS (SELECT 1 FROM public.v2_ingredient_profile_sources) OR
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{READER}') OR
    EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{login}')
 THEN RAISE EXCEPTION 'temporary hosted acceptance requires empty canonical catalog and absent reader roles'; END IF;
END $pre$;
CREATE ROLE {READER} NOLOGIN NOINHERIT NOBYPASSRLS;
CREATE ROLE {login} LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD '{secret}';
GRANT {READER} TO {login} WITH INHERIT FALSE, SET TRUE;
GRANT USAGE ON SCHEMA public TO {READER};
GRANT SELECT ON public.v2_ingredients,public.v2_ingredient_source_records,
 public.v2_ingredient_profile_sources,public.v2_ingredient_nutrition_profiles TO {READER};
CREATE POLICY v2_ingredient_catalog_reader_select ON public.v2_ingredients
 FOR SELECT TO {READER} USING (true);
CREATE POLICY v2_source_catalog_reader_select ON public.v2_ingredient_source_records
 FOR SELECT TO {READER} USING (true);
CREATE POLICY v2_profile_source_catalog_reader_select ON public.v2_ingredient_profile_sources
 FOR SELECT TO {READER} USING (true);
CREATE POLICY v2_profile_catalog_reader_select ON public.v2_ingredient_nutrition_profiles
 FOR SELECT TO {READER} USING (true);
INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,normalized_name,identity_kind,status)
 VALUES('{I}','red_onion_raw','Red Onion Raw','red onion raw','generic_food','active');
INSERT INTO public.v2_ingredient_nutrition_profiles
 (id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,
  coverage_status,review_status,source_quality,profile_revision,required_nutrient_set_version)
 VALUES('{P}','{I}','raw','g',100,'100 g','launch_core_complete','candidate',
  'Foundation',1,'cookbook-launch-macros-v1');
INSERT INTO public.v2_ingredient_source_records
 (id,ingredient_id,provider,source_data_type,external_record_id,source_description,
  source_quality,source_license,payload_sha256,mapping_status)
 VALUES('{S}','{I}','usda_fdc','Foundation','{FOOD_ID}',
  'Onions, red, raw','foundation_review','CC0','{digest}','mapped');
INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role)
 VALUES('{P}','{S}','primary');
COMMIT;
SELECT 'fixture_ready';
"""


def reader_sql(login, digest):
    return f"""
BEGIN READ ONLY;
SET LOCAL ROLE {READER};
DO $verify$ DECLARE found_count integer;
BEGIN
 IF session_user::text<>'{login}' OR current_user::text<>'{READER}'
 THEN RAISE EXCEPTION 'not independently authenticated restricted reader'; END IF;
 IF NOT (SELECT rolcanlogin AND NOT rolsuper AND NOT rolbypassrls
         FROM pg_roles WHERE rolname=session_user)
 THEN RAISE EXCEPTION 'unsafe independent reader login'; END IF;
 IF has_table_privilege(current_user,'public.v2_ingredient_nutrition_profiles','UPDATE')
 OR has_table_privilege(session_user,'public.v2_ingredient_source_records','UPDATE')
 THEN RAISE EXCEPTION 'catalog reader has direct write grant'; END IF;
 SELECT COUNT(*) INTO found_count
 FROM public.v2_ingredient_source_records s
 JOIN public.v2_ingredient_profile_sources ps
   ON ps.source_record_id=s.id AND ps.evidence_role='primary'
 JOIN public.v2_ingredient_nutrition_profiles p ON p.id=ps.profile_id
 JOIN public.v2_ingredients i ON i.id=s.ingredient_id AND p.ingredient_id=i.id
 WHERE s.provider='usda_fdc' AND s.source_data_type='Foundation'
 AND s.external_record_id='{FOOD_ID}' AND s.source_description='Onions, red, raw'
 AND s.payload_sha256='{digest}'
 AND p.id='{P}' AND p.preparation_state='raw' AND p.basis_quantity=100
 AND p.basis_unit='g' AND p.profile_revision=1 AND p.review_status='candidate'
 AND i.status='active';
 IF found_count<>1 THEN RAISE EXCEPTION 'independent catalog reader mapping mismatch'; END IF;
END $verify$;
ROLLBACK;
BEGIN;
SET LOCAL ROLE {READER};
DO $deny$ BEGIN
 BEGIN
  UPDATE public.v2_ingredient_nutrition_profiles SET reviewed_at=clock_timestamp()
   WHERE id='{P}';
  RAISE EXCEPTION 'unexpected direct profile UPDATE access';
 EXCEPTION WHEN insufficient_privilege THEN NULL;
 END;
END $deny$;
ROLLBACK;
SELECT 'independent_reader_pass';
"""


def cleanup_sql(login):
    return f"""
BEGIN;
DELETE FROM public.v2_ingredient_profile_sources WHERE source_record_id='{S}';
DELETE FROM public.v2_ingredient_source_records WHERE id='{S}';
DELETE FROM public.v2_ingredient_nutrition_profiles WHERE id='{P}';
DELETE FROM public.v2_ingredients WHERE id='{I}';
DROP POLICY IF EXISTS v2_ingredient_catalog_reader_select ON public.v2_ingredients;
DROP POLICY IF EXISTS v2_source_catalog_reader_select ON public.v2_ingredient_source_records;
DROP POLICY IF EXISTS v2_profile_source_catalog_reader_select ON public.v2_ingredient_profile_sources;
DROP POLICY IF EXISTS v2_profile_catalog_reader_select ON public.v2_ingredient_nutrition_profiles;
REVOKE SELECT ON public.v2_ingredients,public.v2_ingredient_source_records,
 public.v2_ingredient_profile_sources,public.v2_ingredient_nutrition_profiles FROM {READER};
REVOKE USAGE ON SCHEMA public FROM {READER};
REVOKE {READER} FROM {login};
DROP ROLE {login};
DROP ROLE {READER};
COMMIT;
SELECT 'cleanup_complete';
"""


def fixture_ownership_sql(login, digest):
    # A lost COMMIT acknowledgement must not leave live credentials behind.
    # Never clean an unrelated existing catalog role: ownership requires the
    # fresh random login AND our exact fixture/source digest.
    return f"""
SELECT CASE WHEN to_regrole('{login}') IS NOT NULL
 AND to_regrole('{READER}') IS NOT NULL
 AND EXISTS(SELECT 1 FROM public.v2_ingredient_source_records
   WHERE id='{S}' AND external_record_id='{FOOD_ID}'
     AND payload_sha256='{digest}')
 AND EXISTS(SELECT 1 FROM public.v2_ingredient_nutrition_profiles
   WHERE id='{P}' AND review_status='candidate')
 THEN 'owned' ELSE 'absent' END;
"""


def verify_clean_sql(login):
    return f"""
SELECT CASE WHEN
 (SELECT count(*) FROM public.v2_ingredients)=0 AND
 (SELECT count(*) FROM public.v2_ingredient_source_records)=0 AND
 (SELECT count(*) FROM public.v2_ingredient_nutrition_profiles)=0 AND
 (SELECT count(*) FROM public.v2_ingredient_profile_sources)=0 AND
 to_regrole('{login}') IS NULL AND to_regrole('{READER}') IS NULL AND
 (SELECT count(*) FROM allin_private.v2_ingredient_review_events)=0
 THEN 'clean' ELSE 'not_clean' END;
"""


def main():
    if not shutil.which("psql"):
        raise RuntimeError("psql is required on the trusted PC")
    ca = os.environ.get("ALL228_STAGING_CA_CERT", "")
    if not ca or not Path(ca).is_file():
        raise RuntimeError("Trusted CA missing: set ALL228_STAGING_CA_CERT")
    import json
    digest_data = json.loads(DIGEST_PATH.read_text(encoding="utf8"))
    if digest_data["archiveSha256"] != "dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579":
        raise RuntimeError("USDA archive pin changed; refusing hosted acceptance")
    digest = next(r["sourcePayloadSha256"] for r in digest_data["records"]
                  if r["fdcId"] == int(FOOD_ID))
    if not sys.stdin.isatty():
        raise RuntimeError("Run on trusted PC interactively; never from a public CI job")
    print("ALL-228: temporary staging project fbtgknlxjyeqrxemskbl only.")
    print("Independent reader login, candidate read, denied UPDATE, teardown.")
    admin = getpass.getpass("Temporary staging PostgreSQL admin password (hidden): ")
    if not admin:
        raise RuntimeError("Empty admin password refused")
    login = "allin_ing_catalog_reader_temp_" + secrets.token_hex(5)
    secret = secrets.token_hex(32)
    try:
        if "fixture_ready" not in db_call("postgres", admin, ca,
                                         prepare_sql(login, secret, digest)):
            raise RuntimeError("Hosted fixture could not be verified")
        result = db_call(login, secret, ca, reader_sql(login, digest))
        if "independent_reader_pass" not in result:
            raise RuntimeError("Independent hosted reader proof missing")
        print("PASS: separately authenticated restricted reader and denied write")
    finally:
        # Recheck even on failure: SQL setup itself may have committed before an
        # acknowledgement was lost. Never publish credentials to diagnose.
        try:
            owned = db_call("postgres", admin, ca,
                            fixture_ownership_sql(login, digest)).strip()
            if owned == "owned":
                db_call("postgres", admin, ca, cleanup_sql(login))
            verified = db_call("postgres", admin, ca, verify_clean_sql(login))
            if "clean" not in verified.split():
                raise RuntimeError("Cleanup readback failed")
            print("PASS: temporary roles and canonical fixture absent")
        except Exception:
            print("CLEANUP NOT VERIFIED. Delete temporary staging project as scheduled.")
            raise


if __name__ == "__main__":
    main()
