import type {Route} from './core.ts';
import {responseIntegrityIssue,safeFallback} from './provider.ts';
import {validateCoachProposedAction,type CoachProposedAction} from './recipeAction.ts';

export type FinalCoachAnswer={answer:string;confidence:number;needs_escalation:boolean;proposed_action?:CoachProposedAction};

// Finalize model output only after answer integrity. Proposed actions are optional,
// preview/review-only and fail closed unless the exact attached context currently
// authorizes that action kind, target identity and state version.
export function finalizeCoachAnswer(model:{answer:string;confidence:number;needs_escalation:boolean;proposed_action?:unknown},route:Route,appContext:unknown):FinalCoachAnswer{
 const issue=responseIntegrityIssue(model.answer,route);
 if(issue)return {answer:safeFallback(route,issue),confidence:0,needs_escalation:true};
 const base={answer:model.answer.trim(),confidence:Math.max(0,Math.min(1,Number(model.confidence)||0)),needs_escalation:Boolean(model.needs_escalation)};
 const proposed=validateCoachProposedAction(model.proposed_action,appContext);
 return proposed?{...base,proposed_action:proposed}:base;
}
