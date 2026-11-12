/**
 * ALL-239/222 STAGED, NOT DEPLOYED: exact Goal approval service boundary.
 * No network implementation or service key. Trusted dependencies must be
 * supplied by a future authorized Edge owner, with server review proof.
 *
 * The private SQL writer remains inaccessible to app and service roles until
 * an audited gateway can enforce Auth session + review in one transaction.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/;
const TOKEN=/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_BEARER=4096,MAX_REVIEW_AGE_MS=15*60*1000;

function fail(){throw new Error('Goal approval requires current authenticated review');}
function plain(x){return !!x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;}
function exact(x,keys){return plain(x)&&Object.keys(x).sort().join('|')===[...keys].sort().join('|');}
function validId(x){return typeof x==='string'&&UUID.test(x)&&x!=='00000000-0000-0000-0000-000000000000';}
function jwtClaims(token){
 if(typeof token!=='string'||token.length<24||token.length>MAX_BEARER||!TOKEN.test(token))fail();
 try {
  const encoded=token.split('.')[1];
  const decoded=JSON.parse(atob(encoded.replace(/-/g,'+').replace(/_/g,'/')
   .padEnd(Math.ceil(encoded.length/4)*4,'=')));
  if(!validId(decoded?.session_id)||!validId(decoded?.sub))fail();
  return {sessionId:decoded.session_id,subject:decoded.sub};
 }catch{fail();}
}
/** No client-provided ownerId, payload digest, session ID, role or permission. */
export function parseGoalApprovalIntent(payload){
 const keys=['goalId','revisionId','actionId','reviewId','expectedVersion','confirmed'];
 if(!exact(payload,keys)||!validId(payload.goalId)||!validId(payload.revisionId)||
    !validId(payload.actionId)||!validId(payload.reviewId)||
    !Number.isSafeInteger(payload.expectedVersion)||payload.expectedVersion<1||
    payload.confirmed!==true)fail();
 return Object.freeze({
  goalId:payload.goalId,revisionId:payload.revisionId,
  actionId:payload.actionId,reviewId:payload.reviewId,
  expectedVersion:payload.expectedVersion
 });
}
/** Trusted gate and writer must be separate domain-owned server capabilities.
 * authorizeReview checks auth.sessions and stored explicit user approval.
 * commit is the single database transaction (NOT a client/table writer).
 */
export async function prepareAndCommitGoalApproval({
 bearerToken,payload,armed,authClient,authorizeReview,commit,now=()=>Date.now()
}){
 if(armed!==true)throw new Error('Goal approval not enabled');
 if(typeof authClient?.auth?.getUser!=='function'||
    typeof authorizeReview!=='function'||typeof commit!=='function'||
    typeof now!=='function')fail();
 const intent=parseGoalApprovalIntent(payload);
 const claims=jwtClaims(bearerToken);
 const verified=await authClient.auth.getUser(bearerToken);
 const ownerId=verified?.data?.user?.id;
 if(verified?.error||!validId(ownerId)||ownerId!==claims.subject)fail();
 const proof=await authorizeReview({
  ownerId,sessionId:claims.sessionId,...intent
 });
 const time=now(),expiry=Date.parse(proof?.expiresAt??'');
 if(!plain(proof)||proof.approved!==true||proof.cancelled!==false||
    proof.ownerId!==ownerId||proof.sessionId!==claims.sessionId||
    proof.goalId!==intent.goalId||proof.revisionId!==intent.revisionId||
    proof.actionId!==intent.actionId||proof.reviewId!==intent.reviewId||
    proof.expectedVersion!==intent.expectedVersion||
    typeof proof.sha256!=='string'||!SHA.test(proof.sha256)||
    !Number.isFinite(time)||!Number.isFinite(expiry)||expiry<=time||
    expiry>time+MAX_REVIEW_AGE_MS)fail();
 // A token or owner may change while a review or network request is pending.
 const fresh=await authClient.auth.getUser(bearerToken);
 if(fresh?.error||fresh?.data?.user?.id!==ownerId)fail();
 const args=Object.freeze({
  p_user_id:ownerId,p_session_id:claims.sessionId,p_review_id:intent.reviewId,
  p_goal_id:intent.goalId,
  p_candidate_id:intent.revisionId,p_action_id:intent.actionId,
  p_expected_version:intent.expectedVersion,
  p_payload_sha256:proof.sha256
 });
 const receipt=await commit(args);
 if(!plain(receipt)||receipt.goalId!==intent.goalId||
    receipt.revisionId!==intent.revisionId||
    receipt.version!==intent.expectedVersion+1||
    typeof receipt.replayed!=='boolean')fail();
 return Object.freeze({
  goalId:receipt.goalId,revisionId:receipt.revisionId,
  version:receipt.version,replayed:receipt.replayed
 });
}
