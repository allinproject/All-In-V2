#!/usr/bin/env python3
"""ALL-222 native PostgreSQL race acceptance. LOCAL EPHEMERAL DATABASE ONLY.

Prerequisites: PostgreSQL 15+ running on 127.0.0.1:5432 with peer-auth
local postgres administrator; root/runuser permissions. Never operates on
either Supabase project. Run explicitly:
    ALLIN_ISOLATED_NATIVE_POSTGRES=1 python3 scripts/test-v2-ingredient-native-concurrency.py
The test creates a random local database and ephemeral per-test DB logins.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import subprocess
import threading
import time

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "docs/architecture/sql"
EVIDENCE = ROOT / "docs/evidence/ALL-228-EIGHT-DIRECT-FDC-FOOD-FORM-NUTRIENT-BASIS-2026-11-12.json"
POLICY = ROOT / "docs/evidence/ALL-228-EIGHT-ALIAS-AND-PREPARATION-ACCEPTANCE-CANDIDATES-2026-11-12.json"
SOURCE_SHA = "dd414cc9f1a132626bad354ef6655972c78b44aff14f16114dc899708663c579"
def require(ok, message):
    if not ok:
        raise AssertionError(message)
def ident(s):
    require(s.replace("_", "").isalnum() and s[0].isalpha(), "unsafe test identifier")
    return '"' + s + '"'
def lit(s):
    return "'" + str(s).replace("'", "''") + "'"
def run(args, *, env=None, check=True, input_text=None):
    p = subprocess.run(args, input=input_text, text=True, capture_output=True,
                       timeout=30, env=env)
    if check and p.returncode:
        raise AssertionError(f"command failed {args[:4]}: {p.stderr[:1100]}")
    return p
def uuid(group, i):
    return f"{str(group)*8}-{str(group)*4}-4{i:03d}-8{i:03d}-{str(group)*12}"
def main():
    require(os.environ.get("ALLIN_ISOLATED_NATIVE_POSTGRES") == "1",
            "explicit isolated native PostgreSQL opt-in required")
    require(run(["pg_isready", "-h", "127.0.0.1", "-p", "5432"]).returncode == 0,
            "local-only PostgreSQL unavailable")
    suffix = secrets.token_hex(4)
    db = "allin_ing_iso_" + suffix
    actors = ["ing_actor_a_" + suffix, "ing_actor_b_" + suffix]
    athlete = "ing_athlete_" + suffix
    logins = actors + [athlete]
    passwords = {a: secrets.token_hex(22) for a in logins}
    created = False
    def admin(statement, *, database=db, check=True):
        return run(["runuser", "-u", "postgres", "--", "psql",
                    "-X", "-v", "ON_ERROR_STOP=1", "-At", "-d", database,
                    "-c", statement], check=check)
    def client(actor, statement, *, check=False):
        env = {**os.environ, "PGPASSWORD": passwords[actor]}
        return run(["psql", "-X", "-v", "ON_ERROR_STOP=1", "-At",
                    "-h", "127.0.0.1", "-p", "5432",
                    "-U", actor, "-d", db, "-c", statement], env=env, check=check)
    try:
        run(["runuser", "-u", "postgres", "--", "createdb", db])
        created = True
        for role in ["anon", "authenticated", "service_role"]:
            admin(f"DO $$BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname={lit(role)}) THEN CREATE ROLE {ident(role)} NOLOGIN; END IF; END$$;")
        for name in ["V2-INGREDIENT-CANONICAL-CATALOG-SCHEMA-CANDIDATE.sql",
                     "V2-INGREDIENT-CANONICAL-REVIEW-WRITER-CANDIDATE.sql",
                     "V2-INGREDIENT-OPERATOR-CREDENTIAL-LIFECYCLE-CANDIDATE.sql",
                     "V2-INGREDIENT-USDA-ENERGY-ATTESTATION-CANDIDATE.sql"]:
            content = (SQL / name).read_text()
            run(["runuser", "-u", "postgres", "--", "psql", "-X", "-v",
                 "ON_ERROR_STOP=1", "-d", db], input_text=content)
        for actor in logins:
            admin(f"CREATE ROLE {ident(actor)} LOGIN PASSWORD {lit(passwords[actor])}")
            admin(f"GRANT CONNECT ON DATABASE {ident(db)} TO {ident(actor)}")
        for actor in actors:
            admin(f"GRANT allin_v2_ingredient_reviewer TO {ident(actor)}")
            admin("INSERT INTO allin_private.v2_ingredient_review_operators"
                  "(login_role,enabled,enrollment_reference,identity_issuer,identity_subject,"
                  "credential_vault_reference,identity_verified_at,credential_expires_at) VALUES("
                  + ",".join(map(lit, [actor, "ISOLATED-AUTH-" + actor, "test-idp.example",
                          "verified-" + actor, "test-vault-" + actor]))
                  + ",now()-interval '1 hour',now()+interval '1 day')")
        admin(f"GRANT authenticated TO {ident(athlete)}")
        nutrition = {"energy_kcal": ("Energy", "kcal"), "protein_g": ("Protein", "g"),
                     "carbohydrate_g": ("Carbohydrates", "g"), "total_fat_g": ("Fat", "g"),
                     "sodium_mg": ("Sodium", "mg")}
        for code, (label, unit) in nutrition.items():
            admin("INSERT INTO public.v2_nutrient_definitions"
                  "(code,display_name,canonical_unit,launch_core,is_published) VALUES("
                  f"{lit(code)},{lit(label)},{lit(unit)},true,true)")
        bundle = json.loads(EVIDENCE.read_text())
        require(bundle["archiveSha256"] == SOURCE_SHA and len(bundle["records"]) == 8,
                "fixture/source archive drift")
        policy = json.loads(POLICY.read_text())
        states = {r["source_profile_key"]: r["preparation_state"] for r in policy["records"]}
        rows = []
        for i, food in enumerate(bundle["records"], 1):
            key, form = food["profile"], states[food["profile"]]
            identity, profile, source = uuid(1, i), uuid(2, i), uuid(3, i)
            digest = str(i) * 64  # synthetic per-record fixture SHA, not real archive member hash
            admin("INSERT INTO public.v2_ingredients"
                  "(id,canonical_key,canonical_name,normalized_name,identity_kind,status) VALUES("
                  + ",".join(map(lit, [identity, key, food["v1"], key, "generic_food", "active"])) + ")")
            status, revision = ("candidate", 1) if i == 1 else ("reviewed", 3)
            admin("INSERT INTO public.v2_ingredient_nutrition_profiles"
                  "(id,ingredient_id,preparation_state,basis_unit,basis_quantity,basis_label,"
                  "coverage_status,review_status,source_quality,profile_revision,required_nutrient_set_version,is_default) VALUES("
                  + ",".join(map(lit, [profile, identity, form, "g", 100, "100 g",
                              "launch_core_complete", status, "foundation", revision,
                              "cookbook-launch-macros-v1"]))
                  + ",false)")
            admin("INSERT INTO public.v2_ingredient_source_records"
                  "(id,ingredient_id,provider,source_data_type,external_record_id,source_description,"
                  "source_quality,source_license,mapping_status,payload_sha256) VALUES("
                  + ",".join(map(lit, [source, identity, "usda_fdc", "Foundation",
                              food["fdcId"], food["source"], "foundation",
                              "CC0", "mapped", digest])) + ")")
            admin("INSERT INTO public.v2_ingredient_profile_sources(profile_id,source_record_id,evidence_role)"
                  f" VALUES({lit(profile)},{lit(source)},'primary')")
            nutrient_rows = [("energy_kcal", food["energy"]["kcal"]), ("protein_g", food["protein"]),
                             ("carbohydrate_g", food["carbs"]), ("total_fat_g", food["fat"]),
                             ("sodium_mg", food["sodiumMg"])]
            for code, amount in nutrient_rows:
                admin("INSERT INTO public.v2_ingredient_profile_nutrients"
                      f"(profile_id,nutrient_code,amount) VALUES({lit(profile)},{lit(code)},{amount})")
            methods = [food["energy"]]
            if food["energy"].get("alternative"):
                methods.append(food["energy"]["alternative"])
            for energy in methods:
                admin("INSERT INTO allin_private.v2_ingredient_source_energy_evidence"
                      "(source_record_id,source_payload_sha256,archive_sha256,fdc_nutrient_id,"
                      "energy_kcal,source_review_reference) VALUES("
                      f"{lit(source)},{lit(digest)},{lit(SOURCE_SHA)},"
                      f"{int(energy['code'])},{energy['kcal']},"
                      "'ALL-228 pinned Foundation staging fixture')")
            rows.append((profile, source, digest, food))
        profile, source, digest, _ = rows[0]
        cmd = lambda rev, status, key, actor=actors[0], sha=digest: (
            f"SELECT allin_private.v2_review_ingredient_profile_status({lit(profile)},"
            f"{rev},{lit(sha)},{lit(status)},"
            "'Verified staging source and preparation',"
            f"{lit(key)})")
        # Separate socket connections, with separate PostgreSQL logins.
        try:
            athlete_result = client(athlete, cmd(1, "needs_review", uuid(4, 1)))
            require(athlete_result.returncode != 0, "athlete accessed private writer")
            require(client(athlete, "SELECT count(*) FROM public.v2_ingredient_nutrition_profiles").stdout.strip() == "0",
                    "unapproved nutrition leaked")
            outcomes = []
            barrier = threading.Barrier(2)
            def compete(actor, key):
                barrier.wait(timeout=5)
                return client(actor, cmd(1, "needs_review", key, actor))
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                futures = [pool.submit(compete, actor, uuid(4, idx))
                           for idx, actor in enumerate(actors, 1)]
                outcomes = [future.result(timeout=20) for future in futures]
            require(sum(r.returncode == 0 for r in outcomes) == 1,
                    "concurrent same-revision writers both succeeded or both failed")
            require(any("stale ingredient profile review" in r.stderr for r in outcomes),
                    "CAS stale rejection not observed")
            require(admin("SELECT review_status||':'||profile_revision "
                          f"FROM public.v2_ingredient_nutrition_profiles WHERE id={lit(profile)}"
                          ).stdout.strip() == "needs_review:2", "race caused incorrect status/revision")
            require(admin("SELECT count(*) FROM allin_private.v2_ingredient_review_events").stdout.strip() == "1",
                    "concurrent race produced duplicate audits")
            winner = actors[outcomes.index(next(r for r in outcomes if r.returncode == 0))]
            winner_key = uuid(4, outcomes.index(next(r for r in outcomes if r.returncode == 0)) + 1)
            replay = client(winner, cmd(1, "needs_review", winner_key, winner))
            require(replay.returncode == 0 and "replayed" in replay.stdout,
                    "same actor/key replay did not work")

            # Source-lock race: hold a source row locked while reviewer is about
            # to check its digest, then commit a new digest before review resumes.
            lock_sql = ("BEGIN; SELECT 'LOCKED' FROM public.v2_ingredient_source_records "
                        f"WHERE id={lit(source)} FOR UPDATE;")
            locker = subprocess.Popen(
                ["runuser", "-u", "postgres", "--", "psql", "-X", "-v",
                 "ON_ERROR_STOP=1", "-Atq", "-d", db], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, bufsize=1)
            try:
                locker.stdin.write(lock_sql + "\n"); locker.stdin.flush()
                require(locker.stdout.readline().strip() == "LOCKED", "source lock was not acquired")
                with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
                    reviewer = pool.submit(client, actors[0], cmd(2, "reviewed", uuid(5, 1)))
                    time.sleep(0.25)
                    require(not reviewer.done(), "reviewer did not wait for source row lock")
                    locker.stdin.write("UPDATE public.v2_ingredient_source_records SET payload_sha256="
                                       f"{lit('f'*64)} WHERE id={lit(source)}; COMMIT;\n")
                    locker.stdin.flush()
                    stale = reviewer.result(timeout=15)
                    require(stale.returncode != 0 and "source record changed" in stale.stderr,
                            "source digest change was not rejected after concurrent lock")
            finally:
                locker.stdin.close()
                locker.wait(timeout=10)
            # Restore synthetic staging source and accept a fresh reviewed step.
            admin("UPDATE public.v2_ingredient_source_records SET payload_sha256="
                  f"{lit(digest)} WHERE id={lit(source)}")
            accepted = client(actors[0], cmd(2, "reviewed", uuid(5, 2)))
            require(accepted.returncode == 0, "reviewed transition did not commit")
            require(admin("SELECT count(*) FROM allin_private.v2_ingredient_review_events").stdout.strip() == "2",
                    "source race created an extra audit event")
            attested = 0
            for profile_id, _, source_digest, food in rows:
                result = client(actors[0], "SELECT allin_private.v2_attest_ingredient_energy("
                                f"{lit(profile_id)},3,{lit(source_digest)},"
                                "'Verified source-specific energy method')")
                require(result.returncode == 0 and '"status": "attested"' in result.stdout,
                        "energy attestation failed for "+str(food["fdcId"])+": "+result.stderr[:300])
                attested += 1
            require(attested == 8, "not all source energy records attested")
            require(admin("SELECT count(*) FROM allin_private.v2_ingredient_energy_attestations").stdout.strip() == "8",
                    "expected eight immutable attestations")
            require(admin("SELECT count(*) FROM public.v2_ingredient_nutrition_profiles WHERE review_status='calculation_ready'").stdout.strip()=="0",
                    "attestation incorrectly published profile")
            print(json.dumps({"database":"ephemeral localhost native PostgreSQL 15",
                              "fixtureFoods":len(rows),"independentConnections":2,
                              "competingCAS":"one-success-one-stale",
                              "sourceMutationRace":"blocked-until-commit-and-rejected",
                              "idempotentReplay":"passed","audits":2,
                              "energyAttestations":attested,"calculationReady":0,
                              "externalSupabaseTouched":False},sort_keys=True))
        except Exception:
            raise
    finally:
        if created:
            run(["runuser", "-u", "postgres", "--", "dropdb", "--if-exists", "--force", db],check=False)
        for role in logins:
            admin(f"DROP ROLE IF EXISTS {ident(role)}",database="postgres",check=False)
if __name__ == "__main__":
    main()
