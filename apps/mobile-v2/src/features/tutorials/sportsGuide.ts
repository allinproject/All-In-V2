import type { GuidedStep, GuidePosition } from './profileGuide';

export type SportsGuideTarget = 'focus' | 'activities' | 'save';
export const SPORTS_GUIDE_VERSION = 1;
export const SPORTS_GUIDE_STEPS: readonly GuidedStep<SportsGuideTarget>[] = [
  { id:'focus',target:'focus',title:'Choose your training focus',body:'Training Focus is optional. It helps ALL IN prioritize your current goal but never hides other sports. The guide will not choose a focus for you.' },
  { id:'activities',target:'activities',title:'Select your active activities',body:'You can choose multiple activities or say you are just getting started. Other supported activities remain available even when unselected.' },
  { id:'save',target:'save',title:'Save only when you are ready',body:'Your selections become preferences only when you press the real Save Preferences button. Finishing this guide never saves or changes them.' },
];
export function sportsGuideTarget(position:GuidePosition):SportsGuideTarget|null {
  if (position.done) return null;
  if (!Number.isSafeInteger(position.index) || position.index<0 || position.index>=SPORTS_GUIDE_STEPS.length) return null;
  return SPORTS_GUIDE_STEPS[position.index].target;
}
