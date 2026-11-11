import type { GuidePosition, GuidedStep } from './profileGuide';
export type CoachPreferencesGuideTarget='guidance'|'detail'|'changes'|'tone'|'save';
export const COACH_PREFERENCES_GUIDE_VERSION=1;
export const COACH_PREFERENCES_GUIDE_STEPS:readonly GuidedStep<CoachPreferencesGuideTarget>[]=[
 {id:'guidance',target:'guidance',title:'Guidance style',body:'Choose when Coach should offer suggestions: when asked, balanced or proactive. This preference does not grant Coach permission to change a plan.'},
 {id:'detail',target:'detail',title:'Explanation detail',body:'Choose short answers, adaptive detail or more explanation depending on how you like to learn.'},
 {id:'changes',target:'changes',title:'Training plan changes',body:'Coach may suggest changes, but no option allows silently changing an approved training plan. You remain in control.'},
 {id:'tone',target:'tone',title:'Coaching tone',body:'Choose the communication style that works for you. It does not change your training goals or medical guidance.'},
 {id:'save',target:'save',title:'Save Coach Preferences',body:'Only the real Save Coach Preferences button saves choices. This tutorial never saves them, and integration with the Coach runtime is still underway.'},
];
export function coachPreferencesGuideTarget(p:GuidePosition):CoachPreferencesGuideTarget|null{
 return p.done||!Number.isSafeInteger(p.index)||p.index<0||p.index>=COACH_PREFERENCES_GUIDE_STEPS.length?null:COACH_PREFERENCES_GUIDE_STEPS[p.index].target;
}
