import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseDeletionWorkerRequest, isWorkerArmed, isAuthenticatedWorkerToken } from './policy.ts';
const valid = { user_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaa251', request_id: 'cccccccc-cccc-4ccc-8ccc-cccccccc0251' };
test('exact UUID-only payload', () => {
  assert.deepEqual(parseDeletionWorkerRequest(valid), valid);
  for (const invalid of [null, [], {}, {...valid, ignored: 'yes'}, {...valid,user_id:'not-a-uuid'}, {...valid,request_id:'cccccccc-cccc-cccc-cccc-cccccccccccc'}, {...valid,request_id:0}])
    assert.equal(parseDeletionWorkerRequest(invalid), null);
});
test('requires explicit armed flag', () => {
  assert.equal(isWorkerArmed('true'), true);
  for (const value of [undefined,'True','1','false','']) assert.equal(isWorkerArmed(value),false);
});
test('requires long exact configured worker token', () => {
  const token='abcd'.repeat(16);
  assert.equal(isAuthenticatedWorkerToken(token,token),true);
  for (const wrong of [null,'',token.slice(1),token.slice(0,-1)+'z']) assert.equal(isAuthenticatedWorkerToken(wrong,token),false);
  assert.equal(isAuthenticatedWorkerToken('abc','abc'),false);
});
