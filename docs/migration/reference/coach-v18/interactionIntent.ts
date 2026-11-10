import type {Route} from './core.ts';
import {normalize} from './core.ts';

export type InteractionIntent='transaction'|'conversation'|'coaching';
export type InteractionIntentContext={
 intent:InteractionIntent;
 response_style:'concise_action'|'acknowledge_first'|'reasoned_coaching';
 follow_up_question:'only_if_required'|'smallest_useful_only'|'only_if_material';
 rationale:string;
 mutates_state:false;
};

const EXPLICIT_COACHING=/\b(what should i|what do you think|should i|can i|could i|would you|help me|recommend|why did|why is|why am i|how should|how do i|how can i|what now|what next|what about|analy[sz]e|review|explain|strategy|adjust|adapt)\b|\b(plan|build|change)\s+(?:my|this|the)\b/;
const EMOTIONAL=/\b(sucks?|sucked|awful|terrible|frustrat(?:ed|ing)|annoy(?:ed|ing)|mad|angry|disappoint(?:ed|ing)|discourag(?:ed|ing)|proud|excited|stoked|happy|great|awesome|amazing|rough|hard|miserable|nervous|anxious|worried|scared|overwhelmed)\b/;
const MEANINGFUL_ACHIEVEMENT=/\b(?:pr(?:'d|ed)?|personal (?:records?|bests?)|new best|broke (?:my|a|the) [^.?!]{0,90}\brecords?)\b|\b(?:finished|completed)\b[^.?!]{0,80}\b(?:race|5k|10k|half marathon|marathon|ultra|ultramarathon|50k|50[- ]?mile(?:r|s)?|100k|100[- ]?mile(?:r|s)?)\b/;
const ROUTINE_TRANSACTION=/\b(log|logged|add|added|remove|removed|delete|deleted|save|saved|mark|marked|record|recorded|track|tracked|ate|had|drank|finished|completed)\b/;
const DECLARATIVE_DISRUPTION=/\b(i\s+)?missed\s+(my\s+|the\s+)?(?:workout|run|ride|session|training)\b|\b(i\s+)?didn'?t\s+(?:get to|do|finish)\s+(my\s+|the\s+)?(?:workout|run|ride|session|training)\b/;
const DECLARATIVE_RECOVERY_CONCERN=/\b(?:my\s+)?legs?\s+(?:are|feel|felt)?\s*(?:trashed|dead|wrecked|heavy|fried|sore)\b|\b(?:i'?m|i am|feeling)\s+(?:really\s+)?(?:sore|fatigued|wiped|exhausted)\b/;

export function classifyInteractionIntent(message:string,route:Route):InteractionIntentContext{
 const m=normalize(message);
 if(route.safetyCritical)return coaching('safety-critical requests require reasoned guidance and safety handling');
 if(EXPLICIT_COACHING.test(m)||/[?]\s*$/.test(message.trim()))return coaching('the user explicitly asked for advice, explanation, or a decision');
 if(MEANINGFUL_ACHIEVEMENT.test(m))return conversation('the user shared a meaningful achievement without asking for analysis or a prescription');
 if(EMOTIONAL.test(m))return conversation('the message is primarily an emotional or conversational statement');
 if(DECLARATIVE_DISRUPTION.test(m))return conversation('the user reported a disruption without explicitly asking for a prescription');
 if(DECLARATIVE_RECOVERY_CONCERN.test(m))return conversation('the user reported a recovery concern without explicitly asking for a prescription');
 if(route.workflow==='structured_logging')return transaction('structured logging is a routine transaction');
 if(ROUTINE_TRANSACTION.test(m)&&route.workflow==='coach_chat')return transaction('the message is a routine action/update without an explicit coaching request');
 if(route.workflow!=='coach_chat')return coaching(`workflow ${route.workflow} requires task reasoning`);
 return conversation('no explicit action or coaching request was detected');
}

function transaction(rationale:string):InteractionIntentContext{return{intent:'transaction',response_style:'concise_action',follow_up_question:'only_if_required',rationale,mutates_state:false};}
function conversation(rationale:string):InteractionIntentContext{return{intent:'conversation',response_style:'acknowledge_first',follow_up_question:'smallest_useful_only',rationale,mutates_state:false};}
function coaching(rationale:string):InteractionIntentContext{return{intent:'coaching',response_style:'reasoned_coaching',follow_up_question:'only_if_material',rationale,mutates_state:false};}
