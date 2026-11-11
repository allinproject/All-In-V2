import type { GuidePosition, GuidedStep } from './profileGuide';

export type KitchenGuideTarget = 'home'|'work'|'constraints'|'save';
export const KITCHEN_GUIDE_VERSION=1;
export const KITCHEN_GUIDE_STEPS:readonly GuidedStep<KitchenGuideTarget>[]=[
 {id:'home',target:'home',title:'Home cooking equipment',body:'Open each category to mark equipment as Have it, Don\'t have or Unknown. Unknown is not the same as unavailable. This tutorial does not change any answers.'},
 {id:'work',target:'work',title:'Reheating at work',body:'Record work reheating equipment separately. A microwave at home does not mean one is available at work.'},
 {id:'constraints',target:'constraints',title:'Your kitchen constraints',body:'Optional burner, skillet and container counts, plus notes, help make meal prep practical. Leave values blank if unsure.'},
 {id:'save',target:'save',title:'Save your kitchen profile',body:'Only the real Save Kitchen Profile button saves edits. Completing or exiting this guide never submits kitchen data. Coach use of these saved facts is still being integrated.'},
];
export function kitchenGuideTarget(position:GuidePosition):KitchenGuideTarget|null{
 return position.done || !Number.isSafeInteger(position.index) || position.index<0 || position.index>=KITCHEN_GUIDE_STEPS.length
 ?null:KITCHEN_GUIDE_STEPS[position.index].target;
}
