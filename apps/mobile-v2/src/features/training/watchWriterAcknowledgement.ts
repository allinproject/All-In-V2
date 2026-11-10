/**
 * ALL-245/246: display-only acknowledgement gate for Watch lifecycle commands.
 * Consumes responses ONLY from the future authenticated Training owner writer.
 * A transport response is not proof by itself: the actual backend must enforce
 * owner, action-id/payload idempotency, version CAS and one active session.
 */
import type {WatchExecutionCommandDecision,WatchExecutionAction} from './watchExecutionCommandGate.ts';

export type TrainingWriterAcknowledgement={
 ownerId:string;instanceId:string;clientActionId:string;action:WatchExecutionAction;
 expectedSessionVersion:number;resultSessionVersion:number;
 resultState:'active'|'paused'|'finishing'|'completed'|'cancelled'|'abandoned'|'skipped';
 /** Exact writer receipt; a generic 2xx or optimistic state is not a receipt. */
 committed:true;
};
export type WatchAcknowledgementInput={
 authenticatedOwnerId:string|null;expectedOwnerId:string;
 activeSessionGeneration:number;
 submittedAuthSessionGeneration:number;
 submitted:WatchExecutionCommandDecision;
 receipt:TrainingWriterAcknowledgement|null|undefined;
};
export type WatchAcknowledgementDecision=
 |{kind:'confirmed';instanceId:string;action:WatchExecutionAction;
   sessionVersion:number;displayState:'active'|'paused'|'finishing';completionPending:boolean}
 |{kind:'pending'|'reconcile'|'blocked';reason:string;noConfirmedState:true};
const fail=(kind:'pending'|'reconcile'|'blocked',reason:string):WatchAcknowledgementDecision=>
 ({kind,reason,noConfirmedState:true});
const id=(x:unknown)=>typeof x==='string'&&x.trim().length>0&&x.length<=128;

/**
 * A finish request only confirms 'finishing', never a completed activity.
 * ALL-243 must independently confirm the single canonical Completed Activity.
 * A missing/late/ambiguous receipt holds the state and requires owner re-read.
 */
export function resolveWatchWriterAcknowledgement(input:WatchAcknowledgementInput):WatchAcknowledgementDecision {
 if(!input||!id(input.expectedOwnerId)||input.authenticatedOwnerId!==input.expectedOwnerId)
  return fail('blocked','signed_out_or_account_changed');
 if(!Number.isSafeInteger(input.activeSessionGeneration)||input.activeSessionGeneration<0||
    !Number.isSafeInteger(input.submittedAuthSessionGeneration)||
    input.submittedAuthSessionGeneration!==input.activeSessionGeneration)
  return fail('reconcile','auth_generation_changed_before_writer_ack');
 const cmd=input.submitted;
 if(!cmd||cmd.kind!=='submit_to_training_writer')return fail('blocked','no_submitted_training_command');
 if(input.receipt===undefined||input.receipt===null)
  return fail('pending','canonical_writer_receipt_missing');
 const receipt=input.receipt;
 if(receipt.committed!==true||!id(receipt.ownerId)||receipt.ownerId!==input.expectedOwnerId||
    !id(receipt.instanceId)||receipt.instanceId!==cmd.instanceId||
    !id(receipt.clientActionId)||receipt.clientActionId!==cmd.clientActionId||
    receipt.action!==cmd.action||receipt.expectedSessionVersion!==cmd.expectedSessionVersion||
    !Number.isSafeInteger(receipt.resultSessionVersion)||
    receipt.resultSessionVersion<=cmd.expectedSessionVersion)
   return fail('reconcile','writer_receipt_identity_or_version_mismatch');
 const expected=cmd.action==='pause'?'paused':cmd.action==='resume'?'active':'finishing';
 if(receipt.resultState!==expected)
   return fail('reconcile','writer_receipt_state_mismatch');
 return {kind:'confirmed',instanceId:cmd.instanceId,action:cmd.action,
   sessionVersion:receipt.resultSessionVersion,displayState:expected,
   completionPending:cmd.action==='request_finish'};
}
