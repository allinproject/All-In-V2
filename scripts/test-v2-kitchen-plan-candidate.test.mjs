import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../docs/architecture/sql/V2-KITCHEN-MEAL-PLAN-OWNER-CANDIDATE.sql',import.meta.url),'utf8');
test('Kitchen Plan has only one owner source and typed per-date/meal entries',()=>{
 for(const name of ['v2_kitchen_plan_weeks','v2_kitchen_plan_entries','v2_kitchen_plan_actions'])
  assert.match(sql,new RegExp('create table (?:public|allin_private)\\.'+name+'\\s*\\(','i'));
 for(const field of ['eat_date date not null','meal_slot text not null','source_kind text not null','source_id text not null','portions numeric','execution_mode text not null'])
  assert.ok(sql.includes(field),'Missing typed field: '+field);
 assert.match(sql,/source_kind in \('recipe','food','prepared_meal'\)/);
 assert.match(sql,/source_kind <> 'recipe' or portions = 1/);
 assert.match(sql,/foreign key \(user_id,week_start\)/);
});
test('Kitchen Plan protects owner, rejects direct authenticated client DML, gates RPCs',()=>{
 for(const name of ['v2_kitchen_plan_weeks','v2_kitchen_plan_entries','v2_kitchen_plan_actions'])
  assert.match(sql,new RegExp('alter table (?:public|allin_private)\\.'+name+' enable row level security','i'));
 for(const name of ['v2_kitchen_plan_weeks','v2_kitchen_plan_entries'])
  assert.match(sql,new RegExp('revoke all on public\\.'+name+' from public, anon, authenticated, service_role','i'));
 assert.match(sql,/v_user uuid := auth\.uid\(\)/);
 assert.match(sql,/p_expected_user_id is distinct from v_user/);
 assert.match(sql,/security definer set search_path=''/);
 assert.match(sql,/grant execute on function public\.v2_kitchen_read_plan_week\(uuid,date\) to authenticated/);
 assert.match(sql,/grant execute on function public\.v2_kitchen_replace_plan_week\(uuid,date,bigint,uuid,jsonb\)/);
});
test('Kitchen Plan writer serializes, CAS checks and replays only identical actions',()=>{
 assert.match(sql,/pg_advisory_xact_lock/);
 assert.match(sql,/for update/);
 assert.match(sql,/v_prior\.payload is distinct from p_entries/);
 assert.match(sql,/action_id=p_action_id/);
 assert.match(sql,/v_version<>p_expected_version/);
 assert.match(sql,/errcode='40001'/);
 assert.match(sql,/jsonb_array_length\(p_entries\)>150/);
 assert.match(sql,/v_id=any\(v_ids\)/);
 assert.match(sql,/v_date>=p_week_start\+7/);
 assert.match(sql,/source_kind='food'/i);
});
test('Kitchen planning has no consumption or shopping writes and is review-only',()=>{
 assert.match(sql,/REVIEW-ONLY CANDIDATE/);
 assert.doesNotMatch(sql,/\b(?:insert into|update|delete from)\s+(?:public|allin_private)\.v2_(?:fuel_food|food_log|pantry|shopping)/i);
 assert.doesNotMatch(sql,/\bgrant\s+(?:insert|update|delete|all)\s+on\s+public\.v2_kitchen_plan_entries\s+to\s+authenticated/i);
});
