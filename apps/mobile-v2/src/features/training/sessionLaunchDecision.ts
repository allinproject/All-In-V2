/** ALL-246: pure workout start/resume preflight. Canonical server RPC must re-check auth and atomically enforce one active session across devices. */
export type ActiveExecution = { id:string;ownerId:string;status:'active'|'paused'|'finishing';revisionSessionId:string|null };
export type PlannedWorkout = {revisionSessionId:string;ownerId:string;planRevisionId:string;slotId:string;status:'planned'|'completed'|'skipped'|'cancelled';revisionAccepted:boolean;currentPlanRevisionId:string};
export type LaunchContext = {expectedOwnerId:string;authenticatedOwnerId:string|null;accessGateReady:boolean;activeExecution:ActiveExecution|null|undefined;workout:PlannedWorkout|null};
export type LaunchDecision = {kind:'resume';instanceId:string;reason:'existing_active_execution'}|{kind:'start';revisionSessionId:string;planRevisionId:string;slotId:string}|{kind:'blocked';reason:'signed_out'|'wrong_owner'|'access_gate_required'|'active_session_unverified'|'invalid_active_execution'|'workout_unavailable'|'workout_not_startable'|'stale_plan_revision'};
export function resolveSessionLaunch(context:LaunchContext):LaunchDecision {
 if(!context.authenticatedOwnerId)return{kind:'blocked',reason:'signed_out'};
 if(!context.expectedOwnerId||context.expectedOwnerId!==context.authenticatedOwnerId)return{kind:'blocked',reason:'wrong_owner'};
 if(!context.accessGateReady)return{kind:'blocked',reason:'access_gate_required'};
 if(context.activeExecution===undefined)return{kind:'blocked',reason:'active_session_unverified'};
 if(context.activeExecution){
  if(!context.activeExecution.id||context.activeExecution.ownerId!==context.expectedOwnerId)return{kind:'blocked',reason:'invalid_active_execution'};
  return{kind:'resume',instanceId:context.activeExecution.id,reason:'existing_active_execution'};
 }
 const w=context.workout;
 if(!w||!w.revisionSessionId||!w.planRevisionId||!w.slotId||w.ownerId!==context.expectedOwnerId)return{kind:'blocked',reason:'workout_unavailable'};
 if(w.status!=='planned'||!w.revisionAccepted)return{kind:'blocked',reason:'workout_not_startable'};
 if(!w.currentPlanRevisionId||w.currentPlanRevisionId!==w.planRevisionId)return{kind:'blocked',reason:'stale_plan_revision'};
 return{kind:'start',revisionSessionId:w.revisionSessionId,planRevisionId:w.planRevisionId,slotId:w.slotId};
}
