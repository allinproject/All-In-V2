/**
 * ALL-245/246: read-only preflight for a Watch workout lifecycle command.
 * Only Training's canonical, authenticated and idempotent writer can commit a
 * state transition. Offline proposals are not a confirmation or a replay queue.
 */
import {resolveWatchSessionAttachment, type WatchSessionAttachmentInput} from './watchSessionAttachment.ts';

export type WatchExecutionAction = 'pause' | 'resume' | 'request_finish';
export type WatchExecutionCommandInput = {
  attachment: WatchSessionAttachmentInput;
  action: WatchExecutionAction;
  clientActionId: string;
  /** The version at which the athlete actually issued this action. */
  expectedSessionVersion: number;
  /** Must be the immutable session ID the device showed when user acted. */
  intendedSessionId: string;
};
export type WatchExecutionCommandDecision =
  | {kind:'submit_to_training_writer';instanceId:string;clientActionId:string;
      expectedSessionVersion:number;action:WatchExecutionAction;noLocalCommit:true}
  | {kind:'blocked'|'reconcile';reason:string;noLocalCommit:true};
const reject=(kind:'blocked'|'reconcile',reason:string):WatchExecutionCommandDecision=>({kind,reason,noLocalCommit:true});
const validId=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=128;

/**
 * A read-only plan for a canonical writer call, NOT a device-to-database action.
 * Never silently rebase an old Watch command onto a newer session version:
 * a retry needs the writer's exact action identity and payload to stay stable.
 */
export function resolveWatchExecutionCommand(input:WatchExecutionCommandInput):WatchExecutionCommandDecision {
  if(!input||!validId(input.clientActionId)||!validId(input.intendedSessionId)||
     !Number.isSafeInteger(input.expectedSessionVersion)||input.expectedSessionVersion<0||
     !['pause','resume','request_finish'].includes(input.action))
    return reject('blocked','invalid_command_identity_or_version');
  const attachment=resolveWatchSessionAttachment(input.attachment);
  if(attachment.kind!=='attach')return reject(attachment.kind,attachment.reason);
  if(attachment.instanceId!==input.intendedSessionId)
    return reject('reconcile','command_is_for_different_session');
  if(attachment.sessionVersion!==input.expectedSessionVersion ||
     input.attachment.watchKnownSessionVersion!==input.expectedSessionVersion)
    return reject('reconcile','stale_watch_command_requires_reconciliation');
  if(input.action==='pause'&&attachment.state!=='active')
    return reject('blocked','pause_requires_active_session');
  if(input.action==='resume'&&attachment.state!=='paused')
    return reject('blocked','resume_requires_paused_session');
  if(input.action==='request_finish'&&!['active','paused'].includes(attachment.state))
    return reject('blocked','finish_already_in_progress');
  return {kind:'submit_to_training_writer',instanceId:attachment.instanceId,
    clientActionId:input.clientActionId,expectedSessionVersion:input.expectedSessionVersion,
    action:input.action,noLocalCommit:true};
}
