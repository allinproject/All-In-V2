export type CoachReasoningContextContract={
 version:'coach_reasoning_context_contract_v1';
 active_contexts:string[];
 precedence:string[];
 rules:string[];
};

const KNOWN_CONTEXTS=[
 'sport_nutrition_context',
 'sport_training_context',
 'kitchen_capability_context',
 'knowledge_decisions',
 'canonical_endurance_fueling_plan',
 'canonical_workout_detail',
 'canonical_recipe_candidates',
 'private_health_context',
] as const;

/**
 * Makes reasoning precedence explicit without becoming another source of facts.
 * The contract contains no domain data and authorizes no writes.
 */
export function buildCoachReasoningContextContract(context:unknown):CoachReasoningContextContract|null{
 if(!context||typeof context!=='object'||Array.isArray(context))return null;
 const value=context as Record<string,unknown>;
 const active=KNOWN_CONTEXTS.filter(key=>value[key]!==null&&value[key]!==undefined);
 if(!active.length)return null;
 return{
  version:'coach_reasoning_context_contract_v1',
  active_contexts:[...active],
  precedence:[
   'Exact canonical app object identity, state, measurements and reviewed deterministic outputs outrank generalized guidance.',
   'The user’s explicit current correction or constraint outranks stale inference, but does not silently rewrite canonical saved state.',
   'Task-specific bounded reasoning contexts refine generic reviewed knowledge; they do not override contradictory canonical facts.',
   'Reviewed knowledge decisions guide judgment only after more specific evidence above is honored.',
   'Model judgment is last and must leave materially missing or conflicting information unknown.',
  ],
  rules:[
   'When explaining a recommendation, name the actual supplied factors that changed the decision; do not invent post-hoc reasons.',
   'If two supplied contexts conflict and the precedence rules do not resolve the conflict, state the conflict or ask the minimum necessary question rather than blending them into a false fact.',
   'A reasoning context never authorizes a durable write. Mutations still require the owning canonical action/writer and its validation flow.',
   'Do not promote a heuristic, one outcome, or model inference into a permanent user fact.',
  ],
 };
}
