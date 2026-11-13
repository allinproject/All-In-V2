import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const src=readFileSync(fileURLToPath(new URL("./index.ts",import.meta.url)),"utf8");
const supabaseConfig=readFileSync(fileURLToPath(new URL("../../config.toml",import.meta.url)),"utf8");
test("hosted Coach ingress requires JWT verification in Supabase config",()=>{
 const section=supabaseConfig.match(/^\[functions\.v2-coach\]\s*\n([^\[]*)/m)?.[1];
 assert.ok(section,"v2-coach configuration must exist");
 assert.match(section,/^verify_jwt\s*=\s*true\s*$/m);
});
test("V2 Coach Edge source retains default-OFF and read-only model gate",()=>{
 assert.match(src,/ALLIN_V2_COACH_READ_ARMED/);
 assert.match(src,/!=="true"\)return disabled\(\)/);
 assert.match(src,/executeExchange:armed\?armed\.executeExchange:async\(\)=>\(\{status:"blocked"/);
 assert.match(src,/createCoachSupabaseDependencies/);
 assert.match(src,/handleCoachRuntimeRequest/);
 assert.doesNotMatch(src,/OPENAI_API_KEY|ANTHROPIC_API_KEY|ALLIN_V1_/);
 assert.doesNotMatch(src,/supabase\/functions\/allin-coach/);
});
test("V2 Coach Edge still requires Auth bearer and owner RPCs, not request-supplied model",()=>{
 assert.match(src,/createClient\(url,anon/);
 assert.match(src,/Authorization:auth/);
 assert.match(src,/readTranscriptPage:deps\.readTranscriptPage/);
 assert.match(src,/createOrResumeThread:deps\.createOrResumeThread/);
 assert.doesNotMatch(src,/req\.json\(\).*providerGenerate/);
});

test("paid Coach sends require independent release flag and server-only secrets",()=>{
 assert.match(src,/ALLIN_V2_COACH_SEND_ARMED/);
 assert.match(src,/ALLIN_V2_COACH_PROVIDER_SECRET/);
 assert.match(src,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(src,/ALLIN_V2_COACH_REVIEWED_MODEL/);
 assert.match(src,/createCoachArmedRuntime/);
 assert.match(src,/if\(sendArmed\)/);
 assert.match(src,/if\(!serviceKey\|\|!apiKey\|\|!model/);
 assert.doesNotMatch(src,/req\.json\(\).*apiKey/);
});
