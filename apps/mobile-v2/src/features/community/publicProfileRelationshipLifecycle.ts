/** ALL-244: authenticated Community relationship action lifecycle.
 * Reusable client defense-in-depth; NOT an authorization implementation,
 * network integration, or permission to deploy review-only SQL.
 *
 * A write receipt alone is NOT a current follow/block state. Every confirmed
 * operation must be followed by a fresh owner-certified relationship read,
 * bound to the same current account session generation.
 */
import {
  prepareRelationshipMutation, relationshipActionAvailability,
  verifyRelationshipMutationReceipt,
  type RelationshipAction, type RelationshipSnapshot,
  type RelationshipMutationIntent,
} from './publicProfileRelationshipIntent.ts';

export type RelationshipSession = {id:string|null;generation:number};
export type RelationshipCurrentSession = () => Promise<RelationshipSession>;
export type RelationshipOwnerReader = (targetId:string) => Promise<RelationshipSnapshot>;
export type RelationshipOwnerWriter = (intent:RelationshipMutationIntent) =>
  Promise<{actorId:string;targetOwnerId:string;actionId:string;
    action:RelationshipAction;version:number;accepted:boolean;replayed?:boolean}>;

export type ConfirmedRelationshipState={
  intent:RelationshipMutationIntent;
  snapshot:RelationshipSnapshot;
};

function certifySession(s:RelationshipSession, expectedId:string):void{
  if(s.id!==expectedId||!Number.isSafeInteger(s.generation)||s.generation<0)
    throw new Error('Community account session unavailable or changed.');
}

function certifySnapshot(s:RelationshipSnapshot,actorId:string,targetId:string):void{
  if(s.viewerId!==actorId||s.targetOwnerId!==targetId||
     typeof s.viewerBlockedTarget!=='boolean'||
     typeof s.incomingRequestFromTarget!=='boolean')
    throw new Error('Community relationship owner read is foreign or invalid.');
  relationshipActionAvailability(s);
}

function confirmOutcome(action:RelationshipAction,s:RelationshipSnapshot):boolean{
  switch(action){
    case 'follow':return s.relationship==='approved_follower';
    case 'request_follow':return s.relationship==='follow_requested';
    case 'cancel_request':case 'unfollow':return s.relationship==='not_following';
    case 'approve_request':case 'reject_request':
      return !s.incomingRequestFromTarget;
    case 'block':
      return s.relationship==='blocked_either_way'&&s.viewerBlockedTarget;
    case 'unblock':
      return !s.viewerBlockedTarget;
    default:return false; // report requires a separately approved moderation owner.
  }
}

/** No optimistic state update or UI side effect. Rejects cross-account,
 * stale, contradictory, partial and unrelated-write confirmations. Callers
 * should keep the old UI state unresolved after a rejected result.
 */
export async function executeCertifiedRelationshipAction(args:{
  expectedActorId:string;
  targetId:string;
  action:RelationshipAction;
  stableActionId:string;
  active:RelationshipCurrentSession;
  reader:RelationshipOwnerReader;
  writer:RelationshipOwnerWriter;
  isCurrent?:()=>boolean;
}):Promise<ConfirmedRelationshipState>{
  const {expectedActorId,targetId,action,stableActionId,active,reader,writer}=args;
  const isCurrent=args.isCurrent??(()=>true);
  const before=await active();
  certifySession(before,expectedActorId);
  if(!isCurrent())throw new Error('Community relationship view is no longer active.');
  const prior=await reader(targetId);
  const priorSession=await active();
  certifySession(priorSession,expectedActorId);
  if(priorSession.generation!==before.generation||!isCurrent())
    throw new Error('Community account changed before mutation.');
  certifySnapshot(prior,expectedActorId,targetId);
  const intent=prepareRelationshipMutation(prior,action,stableActionId);
  if(action==='report')
    throw new Error('Community reporting requires an approved moderation writer.');
  const receipt=await writer(intent);
  const afterWrite=await active();
  certifySession(afterWrite,expectedActorId);
  if(afterWrite.generation!==before.generation||!isCurrent())
    throw new Error('Community account changed during mutation.');
  verifyRelationshipMutationReceipt(intent,receipt);
  const latest=await reader(targetId);
  const afterRead=await active();
  certifySession(afterRead,expectedActorId);
  if(afterRead.generation!==before.generation||!isCurrent())
    throw new Error('Community account changed after mutation.');
  certifySnapshot(latest,expectedActorId,targetId);
  if(latest.version!==receipt.version||!confirmOutcome(action,latest))
    throw new Error('Community writer receipt lacks current matching owner state.');
  return {intent,snapshot:latest};
}
