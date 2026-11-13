#!/usr/bin/env node
// ALL-12: generate reviewable SQL to restore ONLY missing deployed V2 routines.
// Does not connect to any database, execute SQL, import data, or install cron.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'supabase', 'migrations');
const out = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve('all12-v2-functions-review.sql');

// Checked against read-only authoritative V2 pg_proc/proacl on 2026-11-13.
// The three existing trigger functions must not be replaced.
const deployed = new Map(Object.entries({
  'allin_private.v2_provider_cache_prune_expired': ['p_batch_size integer', null],
  'public.v2_accept_legal_documents': ['p_expected_user_id uuid, p_terms_version text, p_privacy_version text, p_founder_beta_terms_version text, p_age_18_confirmed boolean, p_client_action_id text', 'authenticated'],
  'public.v2_cancel_account_deletion_request': ['p_expected_user_id uuid, p_expected_request_id uuid', 'authenticated'],
  'public.v2_claim_account_deletion_for_processing': ['p_expected_user_id uuid, p_expected_request_id uuid', 'service_role'],
  'public.v2_export_my_account_snapshot': ['p_expected_user_id uuid', 'authenticated'],
  'public.v2_handle_new_user': ['', null],
  'public.v2_my_account_deletion_request': ['p_expected_user_id uuid', 'authenticated'],
  'public.v2_my_health_considerations': ['p_expected_user_id uuid', 'authenticated'],
  'public.v2_my_profile_state': ['', 'authenticated'],
  'public.v2_patch_profile_settings_section': ['p_expected_user_id uuid, p_section text, p_patch jsonb, p_expected_version bigint, p_client_action_id text', 'authenticated'],
  'public.v2_prevent_published_legal_content_change': ['', null],
  'public.v2_provider_cache_get': ['p_provider text, p_cache_key text', 'service_role'],
  'public.v2_provider_cache_prune_expired': ['p_batch_size integer', 'service_role'],
  'public.v2_provider_cache_put': ['p_provider text, p_cache_key text, p_payload jsonb, p_source_quality text, p_source_license text, p_fetched_at timestamp with time zone, p_expires_at timestamp with time zone', 'service_role'],
  'public.v2_record_account_deletion_completion': ['p_expected_user_id uuid, p_expected_request_id uuid', 'service_role'],
  'public.v2_record_account_deletion_failure': ['p_expected_user_id uuid, p_expected_request_id uuid, p_failure_code text', 'service_role'],
  'public.v2_request_account_deletion': ['p_expected_user_id uuid, p_confirm text', 'authenticated'],
  'public.v2_save_health_considerations': ['p_expected_user_id uuid, p_conditions jsonb, p_limitations jsonb, p_coach_opt_in boolean, p_expected_version bigint', 'authenticated'],
  'public.v2_set_onboarding_step': ['p_expected_user_id uuid, p_step text, p_action text, p_expected_version bigint, p_client_action_id text', 'authenticated'],
  'public.v2_set_updated_at': ['', null],
  'public.v2_verify_account_deletion_completion': ['p_expected_request_id uuid', 'service_role']
}));
const existing = new Set(['public.v2_handle_new_user', 'public.v2_prevent_published_legal_content_change', 'public.v2_set_updated_at']);
const canonical = fs.readdirSync(dir).filter(n => /^20\d{12}_.*\.sql$/.test(n)).sort();
if (canonical.length !== 18 || canonical[0].slice(0,14) !== '20261110021548' || canonical.at(-1).slice(0,14) !== '20261111134456') {
  throw new Error('Unexpected migration inventory: require the 18 reviewed live-source versions');
}
const found = new Map();
for (const filename of canonical) {
  const sql = fs.readFileSync(path.join(dir,filename),'utf8');
  const start = /(?:^|\n)\s*create\s+(?:or\s+replace\s+)?function\s+((?:public|allin_private)\.v2_[a-z0-9_]+)\s*\(/gi;
  let m;
  while ((m = start.exec(sql))) {
    const name = m[1].toLowerCase();
    if (!deployed.has(name)) throw new Error('Unreviewed V2 function '+name+' in '+filename);
    const header = sql.slice(m.index).match(/^\s*create\s+(?:or\s+replace\s+)?function\s+/i);
    const beginning = m.index + (sql[m.index]==='\n'?1:0);
    const open = /\$[A-Za-z_0-9]*\$/g;
    open.lastIndex = start.lastIndex;
    const delimiter = open.exec(sql);
    if (!delimiter || delimiter.index > sql.indexOf(';',start.lastIndex)+5000 && sql.indexOf(';',start.lastIndex)>=0) throw new Error('Cannot find function body delimiter '+name);
    const close = sql.indexOf(delimiter[0],delimiter.index+delimiter[0].length);
    if (close < 0) throw new Error('Unclosed function '+name);
    const end = close+delimiter[0].length;
    const suffix = sql.slice(end).match(/^\s*;/);
    if (!suffix) throw new Error('Unexpected function terminator '+name);
    const statement = sql.slice(beginning,end+suffix[0].length).trim();
    found.set(name,{filename,statement});
    start.lastIndex = end+suffix[0].length;
  }
}
const missing=[...deployed.keys()].filter(x=>!found.has(x));
if (missing.length) throw new Error('Missing canonical definitions: '+missing.join(', '));
const selected=[...deployed.entries()].filter(([name])=>!existing.has(name));
if (selected.length!==18) throw new Error('Expected 18 missing functions');
const lines = [
  '-- GENERATED ALL-12 FUNCTION-ONLY RESTORE. REVIEW BEFORE RUNNING.',
  '-- Generated from canonical 18 V2 migrations, latest definition per function.',
  '-- No tables, triggers, migrations ledger, cron scheduler, or data mutation.',
  '-- Target ONLY: all12_real_source_recovery (network-isolated Docker).',
  '-- Compare signatures and ACL against fresh authoritative source before applying.',
  'BEGIN;',
  "SET LOCAL search_path = '';"
];
for (const [name,[identity,role]] of selected) {
  const {filename,statement}=found.get(name);
  lines.push('', '-- '+filename+' :: '+name, statement,
    'REVOKE ALL ON FUNCTION '+name+'('+identity+') FROM PUBLIC, anon, authenticated, service_role;');
  if(role)lines.push('GRANT EXECUTE ON FUNCTION '+name+'('+identity+') TO '+role+';');
}
lines.push('COMMIT;', '');
const output=lines.join('\n');
fs.writeFileSync(out,output,{flag:'wx',mode:0o600});
console.log(JSON.stringify({output:out,canonical_migrations:canonical.length,source_deployed_functions:deployed.size,existing_preserved:existing.size,functions_to_create:selected.length,sql_bytes:Buffer.byteLength(output),cron_schedule_in_output:/\bcron\.(?:schedule|unschedule)\s*\(/i.test(output)}));
if(/\bcron\.(?:schedule|unschedule)\s*\(/i.test(output))throw new Error('Unsafe cron schedule in generated output');
