'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const sql=fs.readFileSync(path.join(__dirname,'../docs/architecture/sql/V2-INGREDIENT-PRIVATE-REVIEW-WRITER-CANDIDATE.sql'),'utf8');
const must=(...patterns)=>patterns.forEach(p=>assert.match(sql,p));
test('SQL candidate is not a migration or a publicly callable review writer',()=>{
 must(/REVIEW-ONLY CANDIDATE, NOT A MIGRATION/i,
 /CREATE ROLE allin_v2_ingredient_review_executor NOLOGIN NOINHERIT NOBYPASSRLS/i,
 /SECURITY DEFINER\s+SET search_path=pg_catalog/i,
 /REVOKE ALL ON FUNCTION allin_private\.v2_ingredient_review_profile[\s\S]*?FROM PUBLIC, anon, authenticated, service_role/i,
 /no GRANT EXECUTE/i);
 assert.doesNotMatch(sql,/\bGRANT\s+EXECUTE\s+ON\s+FUNCTION\b/i);
 assert.doesNotMatch(sql,/SECURITY DEFINER\s+SET search_path=.*\bpublic\b/i);
});
test('reviewer authentication uses approved private operator registry, not athlete role',()=>{
 must(/REFERENCES auth\.users\(id\)/i,
 /approved_by\s*<>\s*reviewer_user_id/i,
 /capability IN \('reviewer','publisher'\)/i,
 /v_enabled IS DISTINCT FROM true/i,
 /v_expires_at<=transaction_timestamp\(\)/i,
 /reviewer not authorized/i);
 assert.doesNotMatch(sql,/GRANT (INSERT|UPDATE|DELETE) ON .* TO authenticated/i);
});
test('transactional review protects stale revisions, concurrent retries and conflicting keys',()=>{
 must(/pg_advisory_xact_lock\(hashtextextended/i,
 /UNIQUE \(actor_user_id, action_id\)/i,
 /FOR UPDATE/i,
 /v_profile\.profile_revision<>p_expected_revision/i,
 /WHERE id=p_profile_id AND profile_revision=p_expected_revision/i,
 /idempotency key reused with different command/i,
 /new_revision = prior_revision \+ 1/i,
 /concurrent profile review update/i);
});
test('private events are immutable and audit source, policy, actor, revision',()=>{
 must(/ENABLE ROW LEVEL SECURITY/i,
 /BEFORE UPDATE OR DELETE ON allin_private\.v2_ingredient_review_events/i,
 /RAISE EXCEPTION 'ingredient review audit events are append-only'/i,
 /actor_user_id,action_id,ingredient_id,profile_id,source_record_id,action/i,
 /source_payload_sha256,energy_policy_version,nutrient_set_version/i);
});
test('source and nutrient guards preserve canonical owner boundaries',()=>{
 must(/payload_sha256=p_source_payload_sha256/i,
 /provider='usda_fdc' AND source_data_type='Foundation'/i,
 /evidence_role='primary'/i,
 /required_nutrient_set_version<>p_nutrient_set_version/i,
 /'energy_kcal','protein_g','carbohydrate_g','total_fat_g','sodium_mg'/i,
 /p_energy_policy_version <> 'usda-fdc-energy-specific-legacy-v1'/i,
 /p_nutrient_set_version <> 'cookbook-launch-macros-v1'/i);
});
test('publication remains explicitly disabled despite any claimed publisher privilege',()=>{
 must(/p_action='publish'[\s\S]*?RAISE EXCEPTION 'publication disabled pending ALL-222 release approval'/i,
 /v_target:='reviewed'/i,
 /profile_review_status/i); // if source comment or column changes, change test to match semantics
 assert.doesNotMatch(sql,/v_target\s*:=\s*'calculation_ready'/i);
});
