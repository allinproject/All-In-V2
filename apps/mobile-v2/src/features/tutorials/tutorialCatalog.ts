/**
 * ALL-263 V2 tutorial catalog.
 * Do not conflate the existence of a route with a tested interactive tutorial.
 * Entry "exploreRoute" opens a REAL V2 screen, never a fake tutorial.
 */
export type TutorialCategory = 'Getting started'|'Training'|'Food & Kitchen'|'Community'|'Profile & Settings'|'Devices';
export type TutorialReadiness = 'planned'|'drafted'|'coded'|'integrated'|'device_validated';
export type TutorialEntry = {
  id: string;
  title: string;
  category: TutorialCategory;
  summary: string;
  readiness: TutorialReadiness;
  /** Optional, verified V2 screen to explore independently from a tutorial. */
  exploreRoute?: '/profile'|'/profile/sports'|'/profile/kitchen'|'/profile/coach-preferences'|'/train';
  /** Canonical deep link to the actual guide; absent until guide wiring is integrated. */
  launchRoute?: '/profile?tutorial=profile-settings'
    | '/profile/sports?tutorial=sports'
    | '/profile/kitchen?tutorial=kitchen'
    | '/profile/coach-preferences?tutorial=coach-preferences';
};
export const V2_TUTORIAL_CATALOG: readonly TutorialEntry[] = [
  {id:'app-tour',title:'Welcome to ALL IN 365',category:'Getting started',summary:'Explore the real V2 app and what each area does.',readiness:'planned',exploreRoute:'/profile'},
  {id:'profile-settings',title:'Profile & Settings',category:'Profile & Settings',summary:'Personalize sports, Kitchen, Coach and your account.',readiness:'integrated',exploreRoute:'/profile',launchRoute:'/profile?tutorial=profile-settings'},
  {id:'sports-interests',title:'Sports & Interests',category:'Profile & Settings',summary:'Learn training focus, active activities, and explicit saving.',readiness:'integrated',exploreRoute:'/profile/sports',launchRoute:'/profile/sports?tutorial=sports'},
  {id:'kitchen',title:'Kitchen',category:'Profile & Settings',summary:'Learn home equipment, work reheating, kitchen constraints and saving.',readiness:'integrated',exploreRoute:'/profile/kitchen',launchRoute:'/profile/kitchen?tutorial=kitchen'},
  {id:'coach-preferences',title:'Coach Preferences',category:'Profile & Settings',summary:'Review guidance, explanations, plan-change approvals and coaching tone.',readiness:'integrated',exploreRoute:'/profile/coach-preferences',launchRoute:'/profile/coach-preferences?tutorial=coach-preferences'},
  {id:'weekly-routine',title:'Weekly Routine',category:'Profile & Settings',summary:'Set preferred training, shopping and meal-prep times.',readiness:'planned'},
  {id:'coach-learning',title:'What Coach Knows',category:'Profile & Settings',summary:'Review, correct and remove learned preferences.',readiness:'planned'},
  {id:'coach-conversation',title:'Working with Coach',category:'Getting started',summary:'Understand Coach guidance, memory and reviewed actions.',readiness:'planned'},
  {id:'training-lifecycle',title:'Training & Workouts',category:'Training',summary:'Plan, launch, record, finish and review activities.',readiness:'planned',exploreRoute:'/train'},
  {id:'strength-logging',title:'Strength Logging',category:'Training',summary:'Log sets, correct details and finish workouts.',readiness:'planned'},
  {id:'progress',title:'Progress & Recovery',category:'Training',summary:'Understand your history, results and recovery.',readiness:'planned'},
  {id:'food-nutrition',title:'Food & Nutrition',category:'Food & Kitchen',summary:'Track food, nutrition and training fuel.',readiness:'planned'},
  {id:'cookbook',title:'Cookbook & Cook Now',category:'Food & Kitchen',summary:'Find a recipe and cook with Coach-adapted instructions.',readiness:'planned'},
  {id:'meal-workspace',title:'Meal Plan, Pantry & Shopping',category:'Food & Kitchen',summary:'Plan meals, check what you have and shop.',readiness:'planned'},
  {id:'meal-prep',title:'Meal Prep & Prepared Meals',category:'Food & Kitchen',summary:'Prepare, store and use finished meal batches.',readiness:'planned'},
  {id:'community-events',title:'Community & EventHub',category:'Community',summary:'Understand activity sharing, events and visibility.',readiness:'planned'},
  {id:'analytics',title:'Customize Analytics',category:'Profile & Settings',summary:'Personalize supported progress views.',readiness:'planned'},
  {id:'gear',title:'Gear & Shoe Tracking',category:'Training',summary:'Manage gear, defaults and mileage.',readiness:'planned'},
  {id:'watch',title:'Apple Watch & Phone Training',category:'Devices',summary:'Use supported phone and watch workout controls.',readiness:'planned'},
  {id:'voice',title:'Siri & Voice Commands',category:'Devices',summary:'Use voice features confirmed on your device.',readiness:'planned'},
] as const;

export function canStartTutorial(tutorial: TutorialEntry): boolean {
  return Boolean(tutorial.launchRoute)
    && (tutorial.readiness === 'integrated' || tutorial.readiness === 'device_validated');
}
/** A release-ready entry must have a usable route, not merely a status label. */
export function tutorialLaunchRoute(tutorial: TutorialEntry): TutorialEntry['launchRoute'] | null {
  return canStartTutorial(tutorial) ? tutorial.launchRoute ?? null : null;
}
export function publishedTutorials(catalog: readonly TutorialEntry[]=V2_TUTORIAL_CATALOG): TutorialEntry[] {
  // Only device-validated tutorials may be presented as completed/release-ready.
  return catalog.filter(item=>item.readiness==='device_validated' && canStartTutorial(item));
}
export function tutorialCatalogCategories(catalog: readonly TutorialEntry[]=V2_TUTORIAL_CATALOG): TutorialCategory[] {
  const order: TutorialCategory[]=['Getting started','Training','Food & Kitchen','Community','Profile & Settings','Devices'];
  return order.filter(category=>catalog.some(item=>item.category===category));
}
export function isExploreRoute(value: unknown): value is NonNullable<TutorialEntry['exploreRoute']> {
  return value==='/profile'||value==='/profile/sports'||value==='/profile/kitchen'
    ||value==='/profile/coach-preferences'||value==='/train';
}
