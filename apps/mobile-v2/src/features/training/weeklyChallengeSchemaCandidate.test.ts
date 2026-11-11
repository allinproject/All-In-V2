import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const sql=readFileSync(new URL('../../../../../docs/architecture/sql/V2-INDOOR-WEEKLY-COMPETITION-OWNER-CANDIDATE.sql',import.meta.url),'utf8');
const has=(rx:RegExp)=>assert.match(sql,rx);
const absent=(rx:RegExp)=>assert.doesNotMatch(sql,rx);

test('candidate is review-only and not a deployed migration or a runnable challenge publisher',()=>{
 has(/REVIEW-ONLY/);
 has(/NOT A MIGRATION/);
 has(/NO V1 data port/);
 absent(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
 absent(/cron\.schedule|pg_cron|SELECT\s+cron\.schedule/i);
});
test('exactly one challenge per Chicago Monday week with bounded lifecycle',()=>{
 has(/week_start date NOT NULL UNIQUE/i);
 has(/extract\(isodow FROM week_start\)=1/i);
 has(/timezone='America\/Chicago'/i);
 has(/state IN \('draft','open','closed','finalized'\)/i);
 has(/opens_at < closes_at/i);
});
test('competition attempt binds same owner to canonical completed activity and deduplicates replay',()=>{
 has(/UNIQUE \(challenge_id,completed_activity_id\)/i);
 has(/FOREIGN KEY \(completed_activity_id,user_id\)\s*REFERENCES public\.v2_completed_activities\(id,user_id\)/i);
 has(/REFERENCES auth\.users\(id\) ON DELETE CASCADE/i);
 has(/CHECK \(verification_state <> 'verified' OR/i);
});
test('best-attempt projection remains server-owned and cannot point to a different rider',()=>{
 has(/PRIMARY KEY \(challenge_id,user_id\)/i);
 has(/FOREIGN KEY \(best_attempt_id,challenge_id,user_id\)\s*REFERENCES public\.v2_indoor_weekly_attempts\(id,challenge_id,user_id\)/i);
 has(/score BETWEEN 0 AND 100/i);
 has(/verification_state='verified'/i);
});
test('first V2 schema candidate cannot enable publication generation or finalization',()=>{
 for(const field of ['generation_enabled','publication_enabled','finalization_enabled']){
  has(new RegExp(field+' boolean NOT NULL DEFAULT false CHECK \\('+field+'=false\\)','i'));
 }
 absent(/\bGRANT\s+(ALL|INSERT|UPDATE|DELETE)\b/i);
});
test('every competition public table and private config has RLS and client privilege revocation',()=>{
 for(const table of ['public.v2_indoor_weekly_challenges','public.v2_indoor_weekly_attempts',
  'public.v2_indoor_weekly_leaderboard','public.v2_indoor_weekly_achievements',
  'allin_private.v2_indoor_weekly_config']){
  has(new RegExp('ALTER TABLE '+table.replaceAll('.','\\.')+' ENABLE ROW LEVEL SECURITY','i'));
  has(new RegExp('REVOKE ALL ON '+table.replaceAll('.','\\.')+' FROM PUBLIC,anon,authenticated','i'));
 }
 absent(/CREATE POLICY/i);
});
test('award tier enforces exclusive top 1, 2–5 and 6–10 semantics',()=>{
 has(/tier IN \('champion','top_5','top_10'\)/i);
 has(/tier='champion' AND final_rank=1/i);
 has(/tier='top_5' AND final_rank BETWEEN 2 AND 5/i);
 has(/tier='top_10' AND final_rank BETWEEN 6 AND 10/i);
});
