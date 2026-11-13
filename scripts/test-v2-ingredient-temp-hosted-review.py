#!/usr/bin/env python3
"""ALL-228: live hosted reviewer acceptance using an independently authenticated
temporary PostgreSQL login. Never targets production or modifies main.
Stages ONE existing pinned USDA source in the temporary database, exercises
canonical writer + replay inside a ROLLED BACK transaction, then removes
the staging fixture and revokes the login. No publisher grant is created.
"""
import getpass
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import uuid

PROJECT = "fbtgknlxjyeqrxemskbl"
HOST = "aws-1-us-east-1.pooler.supabase.com"
ROLE = "allin_ing_workload_temp_review228"
ROOT = Path(__file__).resolve().parents[1]
DIGEST_FILE = ROOT / "docs/evidence/ALL-225-USDA-EIGHT-PER-FOOD-ENERGY-DIGESTS-2026-11-12.json"
FOOD_FILE = ROOT / "docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json"
ARCHIVE = "dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579"


def db_call(login, password, certificate, script, *, timeout=40):
    env = dict(os.environ)
    for key in ("PGHOST", "PGHOSTADDR", "PGUSER", "PGPORT", "PGDATABASE",
                "PGSERVICE", "PGSERVICEFILE", "PGOPTIONS", "PGPASSFILE",
                "PGSSLROOTCERT", "DATABASE_URL", "PGURI"):
        env.pop(key, None)
    env.update(PGSSLMODE="verify-full", PGSSLROOTCERT=certificate,
               PGPASSWORD=password)
    cmd = ["psql", "-X", "-w", "-q", "-t", "-A",
           "-v", "ON_ERROR_STOP=1", "-h", HOST, "-p", "5432",
           "-U", login + "." + PROJECT, "-d", "postgres", "-f", "-"]
    run = subprocess.run(cmd, input=script, encoding="utf8",
                         stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         env=env, timeout=timeout)
    env.pop("PGPASSWORD", None)
    if run.returncode:
        # psql stderr may echo query context, including a newly generated
        # credential. Never copy its raw output into a terminal or CI log.
        err = run.stderr.lower()
        category = ("authentication" if "password authentication failed" in err
                    else "TLS" if "certificate" in err or "ssl" in err
                    else "privilege" if "permission denied" in err
                    else "constraint" if "constraint" in err
                    else "connection" if "connection" in err
                    else "query")
        raise RuntimeError("Hosted temporary database " + category + " rejection")
    return run.stdout


def literal(value):
    return "'" + str(value).replace("'", "''") + "'"


def main():
    if not shutil.which("psql"):
        raise RuntimeError("psql not available in PATH")
    ca = os.environ.get("ALL228_STAGING_CA_CERT", "")
    if not ca or not Path(ca).is_file():
        raise RuntimeError("Trusted staging CA missing; set ALL228_STAGING_CA_CERT")
    digests = json.loads(DIGEST_FILE.read_text(encoding="utf8"))
    evidence = json.loads(FOOD_FILE.read_text(encoding="utf8"))
    if digests["archiveSha256"] != ARCHIVE or evidence["archiveSha256"] != ARCHIVE:
        raise RuntimeError("Pinned USDA archive digest changed")
    source = next(x for x in evidence["records"] if x["fdcId"] == 790577)
    digest = next(x for x in digests["records"] if x["fdcId"] == 790577)
    if (source["energy"]["kcal"] != 44 or digest["selectedEnergyKcal"] != 44 or
            digest["selectedFdcNutrientId"] != 1008 or
            len(digest["sourcePayloadSha256"]) != 64):
        raise RuntimeError("Pinned raw red onion source energy evidence changed")
    if not sys.stdin.isatty():
        raise RuntimeError("Run interactively on your trusted PC")
    print("ALL-228 reviewer transaction test: temporary staging only.")
    print("One pinned USDA Foundation source (red onion FDC 790577); no publication.")
    if input("Type TEMP to confirm this disposable project: ").strip() != "TEMP":
        raise RuntimeError("Cancelled without database changes")
    admin_pw = getpass.getpass("TEMP project administrator database password (hidden): ")
    if not admin_pw:
        raise RuntimeError("Empty administrator password")
    global ROLE
    ROLE = "allin_ing_workload_temp_" + secrets.token_hex(5)
    worker_pw = secrets.token_hex(32)
    ident, profile, source_id, alias = [str(uuid.uuid4()) for _ in range(4)]
    review_key1, review_key2 = [str(uuid.uuid4()) for _ in range(2)]
    d = digest["sourcePayloadSha256"]
    # All identifiers, food values and source evidence are fixed/reviewed and
    # never composed from user input. Password is random hex, no SQL quoting.
    setup = (
        "BEGIN;\n"
        "DO $check$ BEGIN IF EXISTS (SELECT 1 FROM public.v2_ingredient_source_records "
        "WHERE provider='usda_fdc' AND source_data_type='Foundation' "
        "AND external_record_id='790577') OR EXISTS "
        "(SELECT 1 FROM pg_roles WHERE rolname='" + ROLE + "') "
        "THEN RAISE EXCEPTION 'existing source or workload collision'; "
        "END IF; END $check$;\n"
        "CREATE ROLE " + ROLE + " LOGIN NOINHERIT NOBYPASSRLS "
        "NOCREATEDB NOCREATEROLE PASSWORD '" + worker_pw + "';\n"
        "GRANT allin_v2_ingredient_reviewer TO " + ROLE +
        " WITH INHERIT FALSE, SET TRUE;\n"
        "REVOKE CREATE ON SCHEMA public FROM " + ROLE + ";\n"
        "INSERT INTO allin_private.v2_ingredient_review_operators "
        "(login_role,principal_kind,enabled,enrollment_reference,identity_issuer,"
        "identity_subject,credential_vault_reference,identity_verified_at,credential_expires_at)"
        " VALUES('" + ROLE + "','workload',true,'ALL228-TEMP-REVIEW-ONLY',"
        "'allin-v2-internal-workload','ingest-temp-review228-" + ROLE[-10:] + "',"
        "'ALL228-LOCAL-" + ROLE[-10:] + "',clock_timestamp(),"
        "clock_timestamp()+interval '10 minutes');\n"
        "INSERT INTO public.v2_ingredients(id,canonical_key,canonical_name,"
        "normalized_name,identity_kind,status) VALUES(" + literal(ident) + ","
        + literal("all228_temp_red_onion_" + ident.replace("-","")) + ","
        "'Red onion raw source smoke','red onion raw','generic_food','active');\n"
        "INSERT INTO public.v2_ingredient_nutrition_profiles"
        "(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,"
        "coverage_status,review_status,source_quality,profile_revision,"
        "required_nutrient_set_version,is_default) VALUES("
        + literal(profile) + "," + literal(ident) +
        ",'raw','g',100,'100 g','launch_core_complete','candidate','foundation',1,"
        "'cookbook-launch-macros-v1',true);\n"
        "INSERT INTO public.v2_ingredient_source_records"
        "(id,ingredient_id,provider,source_data_type,external_record_id,"
        "source_description,source_quality,source_license,mapping_status,payload_sha256)"
        " VALUES(" + literal(source_id) + "," + literal(ident) +
        ",'usda_fdc','Foundation','790577','Onions, red, raw',"
        "'foundation','CC0','mapped'," + literal(d) + ");\n"
        "INSERT INTO public.v2_ingredient_profile_sources"
        "(profile_id,source_record_id,evidence_role) VALUES("
        + literal(profile) + "," + literal(source_id) + ",'primary');\n"
        "INSERT INTO public.v2_ingredient_aliases"
        "(id,ingredient_id,normalized_alias,locale,preparation_state,"
        "alias_kind,resolution_scope,status) VALUES("
        + literal(alias) + "," + literal(ident) +
        ",'red onion raw temporary verified form','en','raw',"
        "'source_description','exact','active');\n"
        "INSERT INTO public.v2_nutrient_definitions"
        "(code,display_name,canonical_unit,launch_core,is_published) VALUES"
        "('energy_kcal','Energy','kcal',true,true),"
        "('protein_g','Protein','g',true,true),"
        "('carbohydrate_g','Carbohydrate','g',true,true),"
        "('total_fat_g','Fat','g',true,true),"
        "('sodium_mg','Sodium','mg',false,true) ON CONFLICT (code) DO NOTHING;\n"
    )
    for code, value in [("energy_kcal",44),("protein_g",source["protein"]),
                        ("carbohydrate_g",source["carbs"]),
                        ("total_fat_g",source["fat"]),("sodium_mg",source["sodiumMg"])]:
        setup += ("INSERT INTO public.v2_ingredient_profile_nutrients"
                  "(profile_id,nutrient_code,amount) VALUES("
                  + literal(profile) + "," + literal(code) + ","
                  + str(value) + ");\n")
    setup += "COMMIT;\n"

    # Reviewer session is separately authenticated; transaction always rolls
    # back so immutable review audit rows and state transitions never persist.
    def review(revision, status, key):
        return ("SELECT allin_private.v2_review_ingredient_profile_status("
                + literal(profile) + "," + str(revision) + ","
                + literal(d) + "," + literal(status) + ","
                + literal("Verified pinned USDA red onion source review step " + status)
                + "," + literal(key) + ")::text;\n")
    review_sql = (
        "BEGIN;\nSET LOCAL ROLE allin_v2_ingredient_reviewer;\n"
        "SELECT session_user::text || ':' || current_user::text;\n"
        + review(1,"needs_review",review_key1)
        + review(2,"reviewed",review_key2)
        + review(1,"needs_review",review_key1)
        + review(2,"reviewed",review_key2)
        # Negative hosted controls are executed by the independent reviewer
        # session, inside nested PostgreSQL exception subtransactions. Neither
        # may generate an attestation or make a profile calculation-ready.
        + "DO $reject_energy$ DECLARE message_text text; BEGIN "
        + "BEGIN PERFORM allin_private.v2_attest_ingredient_energy("
        + literal(profile) + ",3," + literal(d) + ","
        + literal("Attempt verified energy attestation without source release evidence")
        + "); RAISE EXCEPTION 'missing energy source should have been rejected'; "
        + "EXCEPTION WHEN SQLSTATE '23514' THEN "
        + "GET STACKED DIAGNOSTICS message_text = MESSAGE_TEXT; "
        + "IF message_text <> 'ambiguous or missing source archive evidence' "
        + "THEN RAISE EXCEPTION 'unexpected source attestation denial'; END IF; "
        + "END; END $reject_energy$;\n"
        + "DO $reject_release$ DECLARE message_text text; BEGIN "
        + "BEGIN PERFORM allin_private.v2_review_ingredient_profile_status("
        + literal(profile) + ",3," + literal(d) + ",'calculation_ready',"
        + literal("Temporarily verify publication hard stop on unqualified USDA source")
        + "," + literal(str(uuid.uuid4())) + "); "
        + "RAISE EXCEPTION 'unapproved calculation-ready transition succeeded'; "
        + "EXCEPTION WHEN SQLSTATE '0A000' THEN "
        + "GET STACKED DIAGNOSTICS message_text = MESSAGE_TEXT; "
        + "IF message_text NOT LIKE 'calculation_ready blocked pending%' "
        + "THEN RAISE EXCEPTION 'unexpected publication denial'; END IF; "
        + "END; END $reject_release$;\n"
        + "ROLLBACK;\n"
    )
    fixture_created = False
    verified = False
    cleanup_success = False
    try:
        db_call("postgres", admin_pw, ca, setup)
        fixture_created = True
        print("Pinned USDA source fixture committed to temporary staging.")
        output = db_call(ROLE, worker_pw, ca, review_sql)
        lines = [x.strip() for x in output.splitlines() if x.strip()]
        if not lines or lines[0] != ROLE + ":allin_v2_ingredient_reviewer":
            raise RuntimeError("Independent reviewer identity/session check failed")
        events = [json.loads(x) for x in lines[1:] if x.startswith("{")]
        if len(events) != 4 or [x.get("review_status") for x in events] != [
                "needs_review","reviewed","needs_review","reviewed"]:
            raise RuntimeError("Unexpected canonical review stage receipts")
        if not all(x.get("status") == "replayed" for x in events[2:]):
            raise RuntimeError("Replay was not idempotent")
        verified = True
        print("PASS independently authenticated USDA review and in-transaction idempotent replay.")
        print("PASS missing USDA energy evidence and calculation-ready publication correctly denied.")
        print("No calculation-ready publication. Writer transaction rolled back.")
    finally:
        # Always revoke credential even if test failed, then remove the fixture
        # in FK order. Audit entries cannot be deleted by design; rollback
        # prevents their creation. If the reviewer transaction ever committed,
        # immutable ledger constraints will prevent cleanup and fail loudly.
        cleanup = ("BEGIN;\n"
                   "DO $safe$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=\u0027" + ROLE + "\u0027) THEN EXECUTE \u0027ALTER ROLE " + ROLE + " PASSWORD NULL\u0027; END IF; END $safe$;\n"
                   "UPDATE allin_private.v2_ingredient_review_operators SET "
                   "enabled=false, credential_expires_at=clock_timestamp(),"
                   "revoked_at=clock_timestamp() WHERE login_role='" + ROLE +
                   "' AND revoked_at IS NULL;\n")
        # Deletion is scoped to freshly generated UUIDs and safe even if the
        # setup COMMIT succeeded but its response was lost.
        cleanup += (
                "DELETE FROM public.v2_ingredient_aliases WHERE id=" + literal(alias) + ";\n"
                "DELETE FROM public.v2_ingredient_profile_nutrients WHERE profile_id=" + literal(profile) + ";\n"
                "DELETE FROM public.v2_ingredient_profile_sources WHERE profile_id=" + literal(profile) + ";\n"
                "DELETE FROM public.v2_ingredient_source_records WHERE id=" + literal(source_id) + ";\n"
                "DELETE FROM public.v2_ingredient_nutrition_profiles WHERE id=" + literal(profile) + ";\n"
                "DELETE FROM public.v2_ingredients WHERE id=" + literal(ident) + ";\n"
            # Never delete shared nutrient definitions.
        )
        cleanup += "COMMIT;\n"
        try:
            db_call("postgres", admin_pw, ca, cleanup)
            clean_sql = (
                "SELECT (NOT EXISTS(SELECT 1 FROM public.v2_ingredients WHERE id="
                + literal(ident) + ") AND NOT EXISTS("
                "SELECT 1 FROM public.v2_ingredient_nutrition_profiles WHERE id="
                + literal(profile) + ") AND NOT EXISTS("
                "SELECT 1 FROM public.v2_ingredient_source_records WHERE id="
                + literal(source_id) + ") AND NOT EXISTS("
                "SELECT 1 FROM allin_private.v2_ingredient_review_events WHERE profile_id="
                + literal(profile) + ") AND NOT EXISTS("
                "SELECT 1 FROM allin_private.v2_ingredient_review_operators "
                "WHERE login_role='" + ROLE + "' AND enabled=true) AND NOT EXISTS("
                "SELECT 1 FROM pg_authid WHERE rolname='" + ROLE
                + "' AND rolpassword IS NOT NULL))::text;")
            clean_proof = db_call("postgres", admin_pw, ca, clean_sql).strip()
            if clean_proof != "true":
                raise RuntimeError("Scoped fixture or enabled credential remained")
            cleanup_success = True
            print("PASS independent cleanup: zero fixture rows or review events; reviewer password revoked.")
        except Exception:
            print("WARNING: hosted fixture cleanup failed; operator expires in 10 minutes.")
        worker_pw = None
        admin_pw = None
        if not cleanup_success:
            raise RuntimeError("Cleanup was not verified; check temporary project before deletion")
    if not verified:
        raise RuntimeError("Hosted reviewer acceptance not established")


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, KeyError, ValueError, subprocess.TimeoutExpired) as error:
        print("ALL-228 hosted review: " + str(error), file=sys.stderr)
        raise SystemExit(1)
