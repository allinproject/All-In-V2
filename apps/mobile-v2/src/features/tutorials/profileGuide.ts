/**
 * ALL-263: intentionally small on-screen Profile guide.
 * No database writes. Only describes controls that exist in V2 today.
 * The generic stepper can be reused by later route-owned guides.
 */
export type ProfileGuideTarget = 'account' | 'sports' | 'kitchen' | 'coach' | 'help' | 'legal';
export type GuidedStep = {
  id: string;
  title: string;
  body: string;
  target: ProfileGuideTarget;
};
export const PROFILE_GUIDE_VERSION = 2;
export const PROFILE_GUIDE_STEPS: readonly GuidedStep[] = [
  { id:'account',title:'Your account',target:'account',body:'Your account details and Edit Profile are here. The guide does not edit anything.' },
  { id:'sports',title:'Your activities',target:'sports',body:'Sports & Interests lets you set Training Focus and the activities you currently do. It does not restrict other sports.' },
  { id:'kitchen',title:'Kitchen equipment',target:'kitchen',body:'Kitchen tracks home cooking equipment, work reheating options and meal-prep constraints. Only changes you save become preferences.' },
  { id:'coach',title:'How Coach responds',target:'coach',body:'Coach Preferences holds guidance, explanation detail, plan-change review and coaching tone. Coach behavior integration is still being built.' },
  { id:'help',title:'Help & Tutorials',target:'help',body:'Return to Help & Tutorials to explore other screens. Additional guided lessons are coming as those features work.' },
  { id:'account-safety',title:'Legal acceptance',target:'legal',body:'This section shows the legal versions accepted for your account. The guide never changes your acceptance or signs you out.' },
] as const;
export type GuidePosition = { index:number; done:boolean };
export function initialGuidePosition(): GuidePosition { return {index:0,done:false}; }
export function guideProgress(position:GuidePosition, length:number):GuidePosition{
  if(!Number.isSafeInteger(length)||length<1)throw new Error('Guide must have at least one step.');
  return {index:Math.max(0,Math.min(length-1,Number.isSafeInteger(position.index)?position.index:0)),done:Boolean(position.done)};
}
export function advanceGuide(position:GuidePosition,length:number):GuidePosition{
  const p=guideProgress(position,length);
  if(p.done)return p;
  return p.index===length-1?{...p,done:true}:{...p,index:p.index+1};
}
export function rewindGuide(position:GuidePosition,length:number):GuidePosition{
  const p=guideProgress(position,length);
  return {index:Math.max(0,p.index-1),done:false};
}
/** Closing the guide discards in-memory progress; replay always starts at step 1. */
export function exitGuide():GuidePosition {return initialGuidePosition();}

/** Return one stable semantic target per guide step; never simulate a button tap. */
export function profileGuideTarget(position: GuidePosition): ProfileGuideTarget | null {
  const current = guideProgress(position, PROFILE_GUIDE_STEPS.length);
  return current.done ? null : PROFILE_GUIDE_STEPS[current.index].target;
}
