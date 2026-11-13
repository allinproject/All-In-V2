#!/usr/bin/env python3
"""ALL-228/225: independently authenticated eight-food hosted seed acceptance.

Temporary project ONLY: fbtgknlxjyeqrxemskbl, with scheduled Nov 13 deletion.
Requires trusted CA, psql, the PINNED original USDA ZIP, and temporary project's
admin PostgreSQL password entered interactively. Nothing runs in production.
Generates two unrelated limited-lived database LOGIN credentials in memory.
Source officer releases 5 independently verified USDA facts per food; distinct
ingest workload seeds 8 candidates using EXISTING canonical tables. Checks 40
stored nutrients, 8 seed audits, 0 published, denied table writes and role
revocation. Scrubs test-only functions/tables, 8 fixtures and both login roles.
Any unresolved cleanup is a hard failure requiring immediate project deletion.
"""
import getpass
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import sys
from decimal import Decimal

ROOT=Path(__file__).resolve().parents[1]
PROJECT="fbtgknlxjyeqrxemskbl"
ARCHIVE="dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579"
SQL_FILE=ROOT/"docs/architecture/sql/V2-INGREDIENT-CANONICAL-SEED-WRITER-CANDIDATE.sql"
EVIDENCE=ROOT/"docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json"
ALIASES=ROOT/"docs/evidence/ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json"
DIGESTS=ROOT/"docs/evidence/ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json"
VERIFIER=ROOT/"scripts/verify-v2-usda-eight-source-nutrients.py"
HELPER=ROOT/"scripts/test-v2-ingredient-temp-hosted-review.py"
SOURCE_ROLE="allin_v2_ingredient_source_releaser"
SOURCE="allin_private.v2_release_ingredient_source_core"
SEED="allin_private.v2_seed_ingredient_candidate"
CORE_FIELDS=("energy_kcal","protein_g","carbohydrate_g","total_fat_g","sodium_mg")
NAMESPACE="ALL-228 canonical USDA identity v1"


def load_module(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def lit(value):
    return "'"+str(value).replace("'","''")+"'"


def stable_id(kind,key,fdc):
    body=json.dumps([NAMESPACE,kind,key,str(fdc)],separators=(",",":"),ensure_ascii=False)
    b=bytearray(hashlib.sha256(body.encode()).digest()[:16])
    b[6]=(b[6]&15)|0x50
    b[8]=(b[8]&63)|0x80
    h=b.hex()
    return "-".join([h[:8],h[8:12],h[12:16],h[16:20],h[20:]])


def fixtures(zip_path):
    verifier=load_module(VERIFIER,"all228_verifier_for_hosted")
    verified=verifier.verify_archive(zip_path)
    evidence=json.loads(EVIDENCE.read_text("utf8"))
    aliases=json.loads(ALIASES.read_text("utf8"))
    hashes=json.loads(DIGESTS.read_text("utf8"))
    if evidence["archiveSha256"]!=ARCHIVE or hashes["archiveSha256"]!=ARCHIVE:
        raise RuntimeError("Original USDA archive pin disagrees with review contracts")
    if not (len(verified)==len(evidence["records"])==8):
        raise RuntimeError("Eight independently verified foods required")
    approved={row["source_profile_key"]:row for row in aliases["records"]}
    digests={row["fdcId"]:row for row in hashes["records"]}
    result=[]
    for row in evidence["records"]:
        info=approved[row["profile"]]
        d=digests[row["fdcId"]]
        if info["source_fdc_id"]!=str(row["fdcId"]):
            raise RuntimeError("Source-form mapping drift")
        fdc=str(row["fdcId"])
        facts={"energy_kcal":row["energy"]["kcal"],"protein_g":row["protein"],
               "carbohydrate_g":row["carbs"],"total_fat_g":row["fat"],"sodium_mg":row["sodiumMg"]}
        if any(not isinstance(v,(int,float)) or isinstance(v,bool) or v<0 for v in facts.values()):
            raise RuntimeError("Unverified or negative source nutrient")
        result.append({"fdc":fdc,"key":row["profile"],"name":info["display_name"],
            "state":info["preparation_state"],"description":row["source"],
            "digest":d["sourcePayloadSha256"],"core":facts,
            "ids":{kind:stable_id(kind,row["profile"],fdc)
                   for kind in ("request","ingredient","profile","source")}})
    if len(result)!=8 or len({f["fdc"] for f in result})!=8:
        raise RuntimeError("Incomplete or duplicate verified USDA inventory")
    return sorted(result,key=lambda x:int(x["fdc"]))


def setup_sql(foods,officer,worker,officer_password,worker_password,nonce):
    ddl=SQL_FILE.read_text("utf8")
    if "NOT A DEPLOYABLE MIGRATION" not in ddl or ddl.count("CREATE OR REPLACE FUNCTION allin_private.v2_seed_ingredient_candidate")!=1:
        raise RuntimeError("Seed candidate SQL is not the reviewed single-owner contract")
    return """
BEGIN;
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM public.v2_ingredients)
 OR EXISTS(SELECT 1 FROM public.v2_ingredient_source_records)
 OR EXISTS(SELECT 1 FROM public.v2_ingredient_nutrition_profiles)
 OR EXISTS(SELECT 1 FROM public.v2_ingredient_profile_sources)
 OR to_regrole('allin_v2_ingredient_source_releaser') IS NOT NULL
 OR to_regclass('allin_private.v2_ingredient_source_core_evidence') IS NOT NULL
 OR to_regclass('allin_private.v2_ingredient_seed_events') IS NOT NULL
 OR EXISTS(SELECT 1 FROM pg_roles WHERE rolname IN ("""+lit(officer)+","+lit(worker)+"""))
 THEN RAISE EXCEPTION 'nonempty/stale canonical catalog or conflicting test roles'; END IF;
END $guard$;
CREATE ROLE allin_v2_ingredient_source_releaser NOLOGIN NOINHERIT NOBYPASSRLS;
"""+ddl+"""
GRANT USAGE ON SCHEMA allin_private TO allin_v2_ingredient_source_releaser;
CREATE ROLE """+officer+" LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD "+lit(officer_password)+""";
CREATE ROLE """+worker+" LOGIN NOINHERIT NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD "+lit(worker_password)+""";
GRANT allin_v2_ingredient_source_releaser TO """+officer+""" WITH INHERIT FALSE,SET TRUE;
GRANT allin_v2_ingredient_reviewer TO """+worker+""" WITH INHERIT FALSE,SET TRUE;
INSERT INTO allin_private.v2_ingredient_review_operators
(login_role,principal_kind,enabled,enrollment_reference,identity_issuer,
 identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at)
VALUES
("""+lit(officer)+""",'human',true,'ALL-228-TEMP-"""+nonce+"""','test-idp.example',
 'verified-usda-source-"""+nonce+"""','vault-test-only-source-"""+nonce+"""',now()-interval '1 minute',now()+interval '12 minutes'),
("""+lit(worker)+""",'workload',true,'ALL-228-TEMP-"""+nonce+"""','allin-v2-internal-workload',
 'ingest-hosted-"""+nonce+"""','vault-test-only-worker-"""+nonce+"""',now()-interval '1 minute',now()+interval '12 minutes');
COMMIT;
SELECT 'setup_committed';
"""


def source_sql(foods,login):
    statements=["BEGIN;","SET LOCAL ROLE "+SOURCE_ROLE+";",
      "DO $auth$ BEGIN IF session_user::text<>"+lit(login)+
      " OR current_user::text<>"+lit(SOURCE_ROLE)+
      " THEN RAISE EXCEPTION 'source session is not independently authenticated'; END IF; END $auth$;"]
    for f in foods:
        statements.append("SELECT "+SOURCE+"("+",".join(map(lit,
          [f["fdc"],f["digest"],ARCHIVE]))+","+lit(json.dumps(f["core"],separators=(",",":")))+"::jsonb) AS result;")
    statements.append("COMMIT;")
    return "\n".join(statements)


def seed_sql(foods,login):
    statements=["BEGIN;","SET LOCAL ROLE allin_v2_ingredient_reviewer;",
      "DO $auth$ BEGIN IF session_user::text<>"+lit(login)+
      " OR current_user::text<>'allin_v2_ingredient_reviewer'"+
      " THEN RAISE EXCEPTION 'seed session is not independently authenticated'; END IF; END $auth$;"]
    for f in foods:
        ids=f["ids"]
        values=[ids["request"],ids["ingredient"],ids["profile"],ids["source"],f["key"],
                f["name"],f["state"],f["fdc"],f["description"],f["digest"],ARCHIVE,
                json.dumps(f["core"],separators=(",",":"))]
        statements.append("SELECT "+SEED+"("+",".join(map(lit,values[:-1]))+
                          ","+lit(values[-1])+"::jsonb) AS result;")
    statements.append("COMMIT;")
    return "\n".join(statements)


def acceptance_sql(foods,officer,worker):
    checks=[]
    for f in foods:
        checks.append("("+lit(f["ids"]["profile"])+","
                      +lit(f["fdc"])+","+lit(f["digest"])+","
                      +",".join(str(Decimal(str(f["core"][code]))) for code in CORE_FIELDS)+")")
    expected=",".join(checks)
    return """
WITH expected(profile_id,fdc_id,payload_sha,energy_kcal,protein_g,carbohydrate_g,total_fat_g,sodium_mg) AS
 (VALUES """+expected+"""),
actual AS (
 SELECT e.profile_id::text AS profile_id,e.fdc_id,e.payload_sha,
        MAX(n.amount) FILTER(WHERE n.nutrient_code='energy_kcal') energy_kcal,
        MAX(n.amount) FILTER(WHERE n.nutrient_code='protein_g') protein_g,
        MAX(n.amount) FILTER(WHERE n.nutrient_code='carbohydrate_g') carbohydrate_g,
        MAX(n.amount) FILTER(WHERE n.nutrient_code='total_fat_g') total_fat_g,
        MAX(n.amount) FILTER(WHERE n.nutrient_code='sodium_mg') sodium_mg
 FROM (SELECT p.id profile_id,s.external_record_id fdc_id,s.payload_sha256 payload_sha
       FROM public.v2_ingredient_nutrition_profiles p
       JOIN public.v2_ingredient_profile_sources l ON l.profile_id=p.id AND l.evidence_role='primary'
       JOIN public.v2_ingredient_source_records s ON s.id=l.source_record_id
       WHERE p.review_status='candidate') e
 JOIN public.v2_ingredient_profile_nutrients n ON n.profile_id=e.profile_id
 GROUP BY 1,2,3
), disagreements AS(
 SELECT e.profile_id FROM expected e LEFT JOIN actual a USING(profile_id,fdc_id,payload_sha)
 WHERE a.profile_id IS NULL OR a.energy_kcal<>e.energy_kcal OR a.protein_g<>e.protein_g
 OR a.carbohydrate_g<>e.carbohydrate_g OR a.total_fat_g<>e.total_fat_g
 OR a.sodium_mg<>e.sodium_mg)
SELECT CASE WHEN
 (SELECT count(*) FROM public.v2_ingredients)=8
 AND (SELECT count(*) FROM public.v2_ingredient_nutrition_profiles WHERE review_status='candidate')=8
 AND (SELECT count(*) FROM public.v2_ingredient_source_records)=8
 AND (SELECT count(*) FROM public.v2_ingredient_profile_sources)=8
 AND (SELECT count(*) FROM public.v2_ingredient_profile_nutrients)=40
 AND (SELECT count(*) FROM allin_private.v2_ingredient_seed_events)=8
 AND (SELECT count(*) FROM allin_private.v2_ingredient_source_core_evidence)=8
 AND (SELECT count(*) FROM disagreements)=0
 AND (SELECT count(*) FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready')=0
 AND (SELECT count(*) FROM allin_private.v2_ingredient_seed_events
      WHERE actor_db_login="""+lit(worker)+""")=8
 AND (SELECT count(*) FROM allin_private.v2_ingredient_source_core_evidence
      WHERE source_releaser_db_login="""+lit(officer)+""")=8
 THEN 'eight_seed_verified' ELSE 'failed_eight_seed' END;
"""


def deny_write_sql(login,role):
    return ("BEGIN;SET LOCAL ROLE "+role+";"
      "DO $deny$ BEGIN IF session_user::text<>"+lit(login)+
      " THEN RAISE EXCEPTION 'wrong independent login'; END IF;"
      " IF has_table_privilege(current_user,'public.v2_ingredient_nutrition_profiles','UPDATE')"
      " OR has_table_privilege(current_user,'public.v2_ingredient_source_records','INSERT')"
      " THEN RAISE EXCEPTION 'direct canonical table write unexpectedly allowed'; END IF;"
      " END $deny$;ROLLBACK;SELECT 'writes_denied';")


def revoke_sql(officer,worker):
    return "BEGIN;ALTER ROLE "+officer+" NOLOGIN PASSWORD NULL;ALTER ROLE "+worker+""" NOLOGIN PASSWORD NULL;
UPDATE allin_private.v2_ingredient_review_operators SET enabled=false,
 credential_expires_at=clock_timestamp(),revoked_at=clock_timestamp()
 WHERE login_role IN ("""+lit(officer)+","+lit(worker)+""") AND enabled;
REVOKE allin_v2_ingredient_source_releaser FROM """+officer+""";
REVOKE allin_v2_ingredient_reviewer FROM """+worker+""";
COMMIT;
SELECT 'both_revoked';
"""


def cleanup_sql(foods,officer,worker):
    # All SQL objects below are temporary additions. Existing canonical
    # catalog and existing reviewer schema/functions are never dropped.
    profiles=",".join(lit(f["ids"]["profile"]) for f in foods)
    sources=",".join(lit(f["ids"]["source"]) for f in foods)
    ingredients=",".join(lit(f["ids"]["ingredient"]) for f in foods)
    return """BEGIN;
ALTER ROLE """+officer+""" NOLOGIN PASSWORD NULL;
ALTER ROLE """+worker+""" NOLOGIN PASSWORD NULL;
REVOKE allin_v2_ingredient_source_releaser FROM """+officer+""";
REVOKE allin_v2_ingredient_reviewer FROM """+worker+""";
UPDATE allin_private.v2_ingredient_review_operators SET enabled=false,
 revoked_at=clock_timestamp(),credential_expires_at=clock_timestamp()
 WHERE login_role IN ("""+lit(officer)+","+lit(worker)+""") AND enabled;
DROP FUNCTION IF EXISTS allin_private.v2_seed_ingredient_candidate(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb);
DROP FUNCTION IF EXISTS allin_private.v2_release_ingredient_source_core(text,text,text,jsonb);
DROP TABLE IF EXISTS allin_private.v2_ingredient_seed_events;
DROP TABLE IF EXISTS allin_private.v2_ingredient_source_core_evidence;
DROP FUNCTION IF EXISTS allin_private.v2_prevent_source_core_evidence_mutation();
DELETE FROM public.v2_ingredient_profile_nutrients WHERE profile_id IN ("""+profiles+""");
DELETE FROM public.v2_ingredient_profile_sources WHERE profile_id IN ("""+profiles+""");
DELETE FROM public.v2_ingredient_source_records WHERE id IN ("""+sources+""");
DELETE FROM public.v2_ingredient_nutrition_profiles WHERE id IN ("""+profiles+""");
DELETE FROM public.v2_ingredients WHERE id IN ("""+ingredients+""");
DELETE FROM allin_private.v2_ingredient_review_operators WHERE login_role IN ("""+lit(officer)+","+lit(worker)+""") AND enabled=false;
DROP ROLE IF EXISTS """+officer+""";
DROP ROLE IF EXISTS """+worker+""";
REVOKE USAGE ON SCHEMA allin_private FROM allin_v2_ingredient_source_releaser;
DROP ROLE IF EXISTS allin_v2_ingredient_source_releaser;
COMMIT;
SELECT 'cleanup_committed';
"""


def clean_sql(officer,worker):
    return (
        "SELECT CASE WHEN (SELECT count(*) FROM public.v2_ingredients)=0"
        " AND (SELECT count(*) FROM public.v2_ingredient_source_records)=0"
        " AND (SELECT count(*) FROM public.v2_ingredient_nutrition_profiles)=0"
        " AND (SELECT count(*) FROM public.v2_ingredient_profile_sources)=0"
        " AND to_regclass('allin_private.v2_ingredient_source_core_evidence') IS NULL"
        " AND to_regclass('allin_private.v2_ingredient_seed_events') IS NULL"
        " AND to_regrole('allin_v2_ingredient_source_releaser') IS NULL"
        " AND to_regrole("+lit(officer)+") IS NULL"
        " AND to_regrole("+lit(worker)+") IS NULL"
        " THEN 'clean' ELSE 'not_clean' END;"
    )


def main():
    if not shutil.which("psql"):
        raise RuntimeError("psql unavailable on trusted PC")
    ca=os.environ.get("ALL228_STAGING_CA_CERT","")
    if not ca or not Path(ca).is_file():
        raise RuntimeError("ALL228_STAGING_CA_CERT requires the trusted existing staging CA path")
    archive=Path(os.environ.get("ALL228_USDA_ARCHIVE",Path.home()/"Downloads/ALL-IN-365-USDA/FoodData_Central_foundation_food_json_2026-10-29.zip"))
    foods=fixtures(archive)
    if not sys.stdin.isatty():
        raise RuntimeError("Operator must run interactively with hidden admin password")
    db_call=load_module(HELPER,"all228_existing_db_call").db_call
    print("ALL-228 temporary project "+PROJECT+" ONLY; verified USDA foods: 8.")
    admin=getpass.getpass("Temporary staging PostgreSQL administrator password (hidden): ")
    if not admin:
        raise RuntimeError("No staging administrator password provided")
    nonce=secrets.token_hex(5)
    officer="allin_usda_source_temp_"+nonce
    worker="allin_ing_workload_temp_"+nonce
    source_pw=secrets.token_hex(32)
    worker_pw=secrets.token_hex(32)
    setup_attempted=False
    succeeded=False
    try:
        setup_attempted=True
        if "setup_committed" not in db_call("postgres",admin,ca,setup_sql(foods,officer,worker,source_pw,worker_pw,nonce),timeout=80):
            raise RuntimeError("Hosted temporary setup was not acknowledged")
        released=db_call(officer,source_pw,ca,source_sql(foods,officer),timeout=80)
        if released.count('"status": "released"')!=8 and released.count('"status":"released"')!=8:
            raise RuntimeError("Independent source officer did not release all 8")
        print("PASS: separately authenticated source officer released 8 immutable five-nutrient records")
        seeded=db_call(worker,worker_pw,ca,seed_sql(foods,worker),timeout=80)
        if seeded.count('"status": "candidate_seeded"')!=8 and seeded.count('"status":"candidate_seeded"')!=8:
            raise RuntimeError("Independent seed workload did not insert all 8 candidates")
        if db_call("postgres",admin,ca,acceptance_sql(foods,officer,worker)).strip()!="eight_seed_verified":
            raise RuntimeError("Hosted 8 sources/40 stored nutrients/audit readback failed")
        print("PASS: 8 canonical candidates, 40 exact source nutrients, 8 audits, 0 published")
        for name,secret,role in [(officer,source_pw,SOURCE_ROLE),(worker,worker_pw,'allin_v2_ingredient_reviewer')]:
            if db_call(name,secret,ca,deny_write_sql(name,role)).strip()!="writes_denied":
                raise RuntimeError("Direct-write denial not verified for "+role)
        print("PASS: independent source and seed roles cannot directly modify canonical tables")
        if "both_revoked" not in db_call("postgres",admin,ca,revoke_sql(officer,worker)):
            raise RuntimeError("Revocation not verified")
        for name,secret in [(officer,source_pw),(worker,worker_pw)]:
            try:
                db_call(name,secret,ca,"SELECT 1;",timeout=15)
                raise RuntimeError("Revoked independent login still authenticated")
            except RuntimeError as exc:
                if "Revoked independent login still authenticated" in str(exc):
                    raise
        print("PASS: both role memberships and password-based authentications revoked")
        succeeded=True
    finally:
        try:
            if setup_attempted:
                # If COMMIT acknowledged or acknowledgement was lost, cleanup
                # belongs to this run ONLY when both random roles are present.
                owned=db_call("postgres",admin,ca,"SELECT CASE WHEN to_regrole("+lit(officer)+") IS NOT NULL AND to_regrole("+lit(worker)+") IS NOT NULL THEN 'owned' ELSE 'absent' END;").strip()
                if owned=="owned":
                    db_call("postgres",admin,ca,cleanup_sql(foods,officer,worker),timeout=80)
            if db_call("postgres",admin,ca,clean_sql(officer,worker)).strip()!="clean":
                raise RuntimeError("Temporary hosted SQL objects or fixture rows remain")
            print("PASS: both temporary logins, seed objects and 8 canonical fixtures cleaned")
        except Exception:
            print("CLEANUP NOT VERIFIED: delete the temporary Supabase staging project by its scheduled deadline.",file=sys.stderr)
            raise
    if not succeeded:
        raise RuntimeError("Independent hosted seed acceptance incomplete")


if __name__=="__main__":
    try:
        main()
    except Exception as exc:
        # Never print raw driver credentials, SQL, or private connection errors.
        print("ALL-228 hosted eight-food acceptance failed: "+type(exc).__name__,file=sys.stderr)
        raise SystemExit(1)
