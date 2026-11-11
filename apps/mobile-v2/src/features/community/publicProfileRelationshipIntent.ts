/** ALL-244: one authoritative Community relationship mutation contract.
 * This module ONLY validates and describes user intent for a future
 * authenticated, owner-checked, versioned Community writer; it does not
 * mutate an account, follow list, block list or profile visibility.
 * Backend must CAS expectedVersion, enforce actor/target/RLS/blocks and
 * provide idempotent action-key recovery before returning confirmed state.
 */
import type {PublicProfileVisibility,PublicProfileRelationship} from './publicProfilePolicy.ts';

export type RelationshipAction=
 'follow'|'request_follow'|'cancel_request'|'unfollow'|
 'approve_request'|'reject_request'|'block'|'unblock'|'report';
export type RelationshipSnapshot={
 viewerId:string;targetOwnerId:string;
 targetVisibility:PublicProfileVisibility;
 relationship:PublicProfileRelationship;
 /** Authoritatively verified reverse-direction follow request to the viewer. */
 incomingRequestFromTarget:boolean;
 /** Viewer has blocked target, as distinguished from the other direction. */
 viewerBlockedTarget:boolean;
 version:number;
};
export type RelationshipMutationIntent={
 actorId:string;targetOwnerId:string;action:RelationshipAction;
 expectedVersion:number;actionId:string;
};
const id=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=150&&x.trim()===x;
export function relationshipActionAvailability(s:RelationshipSnapshot):ReadonlySet<RelationshipAction>{
 if(!id(s.viewerId)||!id(s.targetOwnerId)||s.viewerId===s.targetOwnerId||
  !Number.isSafeInteger(s.version)||s.version<1||
  typeof s.viewerBlockedTarget!=='boolean'||
  typeof s.incomingRequestFromTarget!=='boolean'||
  !['public','private'].includes(s.targetVisibility)||
  !['self','approved_follower','follow_requested','not_following','blocked_either_way'].includes(s.relationship))
  throw new Error('Invalid certified Community relationship snapshot.');
 const allowed=new Set<RelationshipAction>();
 if(s.viewerBlockedTarget){
  if(s.relationship!=='blocked_either_way')throw new Error('Contradictory block evidence.');
  allowed.add('unblock');
  return allowed;
 }
 if(s.relationship==='blocked_either_way')return allowed;
 if(s.relationship==='self')throw new Error('Self relationship is not a follow target.');
 switch(s.relationship){
  case 'not_following':allowed.add(s.targetVisibility==='private'?'request_follow':'follow');break;
  case 'follow_requested':allowed.add('cancel_request');break;
  case 'approved_follower':allowed.add('unfollow');break;
 }
 if(s.incomingRequestFromTarget){
  allowed.add('approve_request');allowed.add('reject_request');
 }
 allowed.add('block');
 allowed.add('report');
 return allowed;
}
export function prepareRelationshipMutation(s:RelationshipSnapshot,action:RelationshipAction,actionId:string):RelationshipMutationIntent{
 const allowed=relationshipActionAvailability(s);
 if(!allowed.has(action))throw new Error('Community action unavailable for current relationship.');
 if(!id(actionId,150))throw new Error('Stable idempotent Community action ID is required.');
 return {actorId:s.viewerId,targetOwnerId:s.targetOwnerId,action,
  expectedVersion:s.version,actionId};
}
/** A backend confirmation must bind identity, request and next revision.
 * An optimistic client-only change is never proof that the new follow/block
 * relationship or any private content is authorized.
 */
export function verifyRelationshipMutationReceipt(
 intent:RelationshipMutationIntent,
 receipt:{actorId:string;targetOwnerId:string;actionId:string;action:RelationshipAction;version:number;accepted:boolean},
):boolean{
 if(receipt.actorId!==intent.actorId||receipt.targetOwnerId!==intent.targetOwnerId||
  receipt.actionId!==intent.actionId||receipt.action!==intent.action||!receipt.accepted||
  !Number.isSafeInteger(receipt.version)||receipt.version<=intent.expectedVersion)
  throw new Error('Unverified Community relationship write receipt.');
 return true;
}
