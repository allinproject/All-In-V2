/** ALL-244 review-only moderator UI boundary.
 * There is deliberately NO Supabase RPC client here: private moderation SQL
 * has no public/authenticated EXECUTE grant. A trusted server adapter must
 * authorize each operation and issue only these minimized response shapes.
 */
export type ReviewPermission='initial_review'|'appeal_review';
export type ModerationDecision='dismiss'|'hold'|'hide'|'uphold'|'overturn';
export type ReviewCase={
 reportId:string;status:'reported'|'appealed';version:number;
 reasonCode:'spam'|'harassment'|'privacy'|'other';submittedAt:string;
};
export type ReviewCursor={submittedAt:string;reportId:string};
export type ReviewQueue={
 permission:ReviewPermission;cases:readonly ReviewCase[];
 complete:boolean;nextCursor:ReviewCursor|null;
};
export type ReviewEvidence={
 reportId:string;status:'reported'|'appealed';version:number;
 reasonCode:ReviewCase['reasonCode'];reasonDetail:string;
 commentId:string;body:string;appealStatement:string|null;
};
export type ReviewResult={
 reportId:string;version:number;decision?:'dismiss'|'hold'|'hide';
 appealDecision?:'uphold'|'overturn';
};
export type ReviewerSession={
 reviewerId:string;generation:number;permission:ReviewPermission;authorized:true;
};
export type ModeratorReviewTransport={
 // Trusted server reads active Auth AND current reviewer permission each call.
 session():Promise<ReviewerSession|null>;
 queue(permission:ReviewPermission,cursor:ReviewCursor|null):Promise<ReviewQueue>;
 // Trusted server creates the unique access UUID and records every evidence open.
 evidence(reportId:string,permission:ReviewPermission):Promise<ReviewEvidence>;
 decide(reportId:string,version:number,decision:'dismiss'|'hold'|'hide'):Promise<ReviewResult>;
 resolveAppeal(reportId:string,version:number,decision:'uphold'|'overturn'):Promise<ReviewResult>;
};
const id=(s:unknown):s is string=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const iso=(s:unknown):s is string=>typeof s==='string'&&
 !Number.isNaN(Date.parse(s))&&s.includes('T');
const exact=(value:object,keys:readonly string[]):boolean=>
 Object.keys(value).length===keys.length&&
 Object.keys(value).every(k=>keys.includes(k))&&keys.every(k=>Object.hasOwn(value,k));
export function validateReviewerSession(s:ReviewerSession|null,permission:ReviewPermission):ReviewerSession{
 if(!s||!exact(s,['reviewerId','generation','permission','authorized'])||
 !id(s.reviewerId)||!Number.isSafeInteger(s.generation)||s.generation<0||
 s.permission!==permission||s.authorized!==true)
 throw new Error('Trusted moderation reviewer session unavailable.');
 return s;
}
export function certifyReviewQueue(raw:ReviewQueue,permission:ReviewPermission):ReviewQueue{
 if(!raw||!exact(raw,['permission','cases','complete','nextCursor'])||
 raw.permission!==permission||typeof raw.complete!=='boolean'||
 !Array.isArray(raw.cases)||raw.cases.length>50||
 (raw.complete!== (raw.nextCursor===null)))throw new Error('Invalid or partial moderator queue.');
 const seen=new Set<string>();let prior='';
 for(const row of raw.cases){
  if(!row||!exact(row,['reportId','status','version','reasonCode','submittedAt'])||
   !id(row.reportId)||seen.has(row.reportId)||!Number.isSafeInteger(row.version)||
   row.version<1||!['spam','harassment','privacy','other'].includes(row.reasonCode)||
   row.status!==(permission==='initial_review'?'reported':'appealed')||!iso(row.submittedAt))
   throw new Error('Unexpected private fields or invalid moderator case.');
  const key=row.submittedAt+'|'+row.reportId;
  if(key<=prior)throw new Error('Moderator queue was not in cursor order.');
  prior=key;seen.add(row.reportId);
 }
 if(raw.nextCursor && (!exact(raw.nextCursor,['submittedAt','reportId'])||
  !id(raw.nextCursor.reportId)||!iso(raw.nextCursor.submittedAt)||
  !raw.cases.length||
  raw.nextCursor.reportId!==raw.cases[raw.cases.length-1].reportId||
  raw.nextCursor.submittedAt!==raw.cases[raw.cases.length-1].submittedAt))
  throw new Error('Invalid moderator continuation cursor.');
 return raw;
}
export function certifyCaseEvidence(
 raw:ReviewEvidence,reportId:string,permission:ReviewPermission
):ReviewEvidence{
 if(!raw||!exact(raw,['reportId','status','version','reasonCode','reasonDetail',
  'commentId','body','appealStatement'])||
 raw.reportId!==reportId||!id(raw.commentId)||!Number.isSafeInteger(raw.version)||
 raw.version<1||raw.status!==(permission==='initial_review'?'reported':'appealed')||
 !['spam','harassment','privacy','other'].includes(raw.reasonCode)||
 typeof raw.reasonDetail!=='string'||raw.reasonDetail.length>500||
 typeof raw.body!=='string'||raw.body.length>4000||
 (permission==='initial_review'?raw.appealStatement!==null:
  typeof raw.appealStatement!=='string'||raw.appealStatement.length>1000))
 throw new Error('Case evidence was foreign, overbroad or unauthorized.');
 return raw;
}
export async function withFreshReviewer<T>(args:{
 permission:ReviewPermission;transport:ModeratorReviewTransport;
 execute:()=>Promise<T>;isCurrent?:()=>boolean;
}):Promise<T>{
 const before=validateReviewerSession(await args.transport.session(),args.permission);
 if(args.isCurrent?.()===false)throw new Error('Moderator screen is no longer active.');
 const result=await args.execute();
 const after=validateReviewerSession(await args.transport.session(),args.permission);
 if(before.reviewerId!==after.reviewerId||before.generation!==after.generation||
 args.isCurrent?.()===false)throw new Error('Reviewer session changed while accessing a case.');
 return result;
}
export function certifyReviewResult(
 result:ReviewResult,reportId:string,expectedRevision:number,decision:ModerationDecision
):ReviewResult{
 const action=decision==='dismiss'||decision==='hold'||decision==='hide'?'decision':'appealDecision';
 if(!result||!exact(result,['reportId','version',action])||
 result.reportId!==reportId||result.version!==expectedRevision+1||
 result[action]!==decision)throw new Error('Moderation decision was not authoritatively confirmed.');
 return result;
}
