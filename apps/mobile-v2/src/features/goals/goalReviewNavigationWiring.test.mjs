import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';

const source = relative => readFileSync(fileURLToPath(new URL(relative,import.meta.url)),'utf8');

test('Train links to the single authenticated canonical Goals screen',()=>{
 const train=source('../../../app/train.tsx');
 const goals=source('../../../app/goals.tsx');
 // Compact Train intentionally omits the legacy Goals shortcut.
 assert.doesNotMatch(train,/href="\\/goals"/);
 assert.match(train,/\\['calendar', 'Calendar'\\]/);
 assert.match(train,/\\['plans', 'Plans'\\]/);
 assert.match(goals,/v2AuthenticatedScreenKey\(user\?\.id \?\? null,sessionGeneration\)/);
 assert.match(goals,/gate\.status === 'legal_required'/);
 assert.match(goals,/gate\.status === 'onboarding_required'/);
 assert.match(goals,/href="\/train"/);
});
test('Goals route does not fabricate a backend result or locally approve plans',()=>{
 const goals=source('../../../app/goals.tsx');
 const panel=source('./GoalReviewPanel.tsx');
 assert.match(goals,/GoalReviewPanel preview=\{null\}/);
 assert.match(goals,/sessionGeneration=\{sessionGeneration\}/);
 assert.match(panel,/goalReviewPresentation\(preview, ownerId, sessionGeneration, nowMs\)/);
 assert.doesNotMatch(panel,/supabase\.rpc|supabase\.from|onPress=\{.*approve/i);
 assert.match(panel,/This is a preview only\. It does not accept, publish, or change your plan/);
});
test('pre-approval preview does not invent an issued consent receipt',()=>{
 const src=source('./goalReviewPresentation.ts');
 assert.match(src,/review\/action ID is minted ONLY after explicit approval/);
 assert.match(src,/preview\.ownerId !== ownerId/);
 assert.match(src,/preview\.authSessionGeneration !== sessionGeneration/);
 assert.match(src,/preview\.complete !== true \|\| preview\.nextCursor !== null/);
 assert.doesNotMatch(src,/reviewId: string|actionId: string/);
});
