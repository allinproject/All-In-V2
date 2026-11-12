import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

const src=readFileSync(fileURLToPath(new URL("./index.ts",import.meta.url)),"utf8");
test("V2 Coach Edge source retains default-OFF and read-only model gate",()=>{
 assert.match(src,/ALLIN_V2_COACH_READ_ARMED/);
 assert.match(src,/!=="true"\)return disabled\(\)/);
 assert.match(src,/executeExchange:async\(\)=>\(\{status:"blocked"/);
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
