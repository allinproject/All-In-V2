/**
 * ALL-251: recurring *preferences*, not dated training/meal events or push registrations.
 * Keep training availability in training_preferences and food routines in
 * nutrition_preferences. Each section has its own explicit versioned save.
 */
export const WEEK_DAYS = [
  {id:'monday',label:'Mon'}, {id:'tuesday',label:'Tue'},
  {id:'wednesday',label:'Wed'}, {id:'thursday',label:'Thu'},
  {id:'friday',label:'Fri'}, {id:'saturday',label:'Sat'},
  {id:'sunday',label:'Sun'},
] as const;
export type WeekDay = typeof WEEK_DAYS[number]['id'];
export type RoutineWindow = 'morning'|'afternoon'|'evening'|'varies';
export const TIME_WINDOWS:readonly {id:RoutineWindow;label:string}[]=[
 {id:'morning',label:'Morning'}, {id:'afternoon',label:'Afternoon'},
 {id:'evening',label:'Evening'}, {id:'varies',label:'Varies'},
];
export type RoutineSlot = {days:WeekDay[];window:RoutineWindow|null};
export type WeeklyRoutine = {training:RoutineSlot;shopping:RoutineSlot;mealPrep:RoutineSlot};
export const emptyRoutineSlot=():RoutineSlot=>({days:[],window:null});
export const emptyWeeklyRoutine=():WeeklyRoutine=>({
 training:emptyRoutineSlot(),shopping:emptyRoutineSlot(),mealPrep:emptyRoutineSlot(),
});
const validDays=new Set<string>(WEEK_DAYS.map(x=>x.id));
const validWindows=new Set<string>(TIME_WINDOWS.map(x=>x.id));
function obj(x:unknown):Record<string,unknown>{
 return x && typeof x==='object' && !Array.isArray(x)?x as Record<string,unknown>:{};
}
export function parseRoutineSlot(x:unknown):RoutineSlot{
 const r=obj(x);
 const days=Array.isArray(r.days)?r.days.filter((d):d is WeekDay=>typeof d==='string'&&validDays.has(d)):[];
 const raw=r.window;
 return {days:WEEK_DAYS.map(x=>x.id).filter(d=>days.includes(d)),
   window:typeof raw==='string' && validWindows.has(raw)?raw as RoutineWindow:null};
}
export function parseWeeklyRoutine(settings:unknown):WeeklyRoutine{
 const s=obj(settings);
 const training=obj(s.training_preferences);
 const nutrition=obj(s.nutrition_preferences);
 const trainingSchedule=obj(training.weekly_routine);
 const nutritionSchedule=obj(nutrition.weekly_routine);
 const trainingSlot=parseRoutineSlot(trainingSchedule.training);
 const available=Array.isArray(training.available_days)?training.available_days:[];
 // Existing onboarding availability is canonical; do not overwrite it by creating
 // a second competing list of training days.
 trainingSlot.days=WEEK_DAYS.map(x=>x.id).filter(d=>available.includes(d));
 return {
  training:trainingSlot,
  shopping:parseRoutineSlot(nutritionSchedule.shopping),
  mealPrep:parseRoutineSlot(nutritionSchedule.meal_prep),
 };
}
export function toggleRoutineDay(slot:RoutineSlot,day:WeekDay):RoutineSlot{
 if(!validDays.has(day))throw new Error('Unsupported weekday');
 const set=new Set(slot.days);
 if(set.has(day))set.delete(day);else set.add(day);
 return {...slot,days:WEEK_DAYS.map(x=>x.id).filter(d=>set.has(d))};
}
export function changeRoutineWindow(slot:RoutineSlot,window:RoutineWindow|null):RoutineSlot{
 if(window!==null&&!validWindows.has(window))throw new Error('Unsupported time window');
 return {...slot,window:slot.window===window?null:window};
}
export function trainingRoutinePatch(slot:RoutineSlot){
 const normalized=parseRoutineSlot(slot);
 return {available_days:normalized.days,
   weekly_routine:{training:{window:normalized.window}}};
}
export function nutritionRoutinePatch(shopping:RoutineSlot,mealPrep:RoutineSlot){
 return {weekly_routine:{shopping:parseRoutineSlot(shopping),meal_prep:parseRoutineSlot(mealPrep)}};
}
