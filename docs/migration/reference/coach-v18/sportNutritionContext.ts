import type {Route} from './core.ts';
import {normalize} from './core.ts';

export type SportNutritionSport='run'|'trail_ultra'|'cycling'|'swimming'|'strength'|'multisport'|'hike_ruck'|'elliptical_stairs'|'yoga_mobility';
export type SportNutritionFuelDemand='minimal'|'moderate'|'high'|'unknown';
export type SportNutritionEnvironmentalValue=string|number|boolean|null;
export type SportNutritionEnergyAvailabilityValue=string|number|boolean|null;
export type SportNutritionHydrationValue=unknown|'unknown';
export type SportNutritionGutToleranceValue=unknown|'unknown';
export type SportNutritionDietaryRestrictionValue=unknown|'unknown';
export type SportNutritionAvailabilityValue='known'|'unavailable'|'unknown';
export type SportNutritionLimitedAccessValue='yes'|'no'|'unknown';
export type SportNutritionFuelCarryingMethod='bottle'|'flask'|'pack'|'pocket'|'aid-station'|'other'|'unknown';
export type SportNutritionFluidCarryingMethod='bottle'|'flask'|'pack'|'aid-station'|'other'|'unknown';
export type SportNutritionRefillAccess='yes'|'no'|'unknown';
export type SportNutritionSessionFacts={sport:string|null;session_type:string|null;duration_minutes:number|null;intensity:string|null;next_session_timing:string|null;another_planned_session_same_day:boolean|null;time_until_next_session:string|number|null;next_session_sport:string|null;next_session_intensity:string|null;session_occurs_overnight:SportNutritionLimitedAccessValue;sleep_deprivation_present:SportNutritionLimitedAccessValue;normal_meal_timing_disrupted:SportNutritionLimitedAccessValue;temperature:SportNutritionEnvironmentalValue;humidity:SportNutritionEnvironmentalValue;heat_stress_context:SportNutritionEnvironmentalValue;cold_exposure_context:SportNutritionEnvironmentalValue;source:'app_context'};
export type SportNutritionEnergyAvailabilityContext={low_energy_availability_reds_risk:SportNutritionEnergyAvailabilityValue;recent_intake_insufficiency:SportNutritionEnergyAvailabilityValue;high_training_load_low_fueling_context:SportNutritionEnergyAvailabilityValue};
export type SportNutritionRecoveryTimingContext={time_since_completed_session:string|number|null;another_planned_session_within_4_hours:boolean|null;another_planned_session_later_same_day:boolean|null;next_planned_session_following_day:boolean|null};
export type SportNutritionPreSessionTimingContext={time_until_planned_session:string|number|null;ate_recently:boolean|null;time_since_last_meal_or_snack:string|number|null};
export type SportNutritionPostSessionIntakeContext={ate_since_session:boolean|null;time_since_first_post_session_meal_or_snack:string|number|null;intake_unknown:boolean};
export type SportNutritionFuelAvailabilityContext={planned_training_fuel_available:SportNutritionAvailabilityValue;fluids_available_during_session:SportNutritionAvailabilityValue;refueling_access_limited:SportNutritionLimitedAccessValue;fuel_carrying_method:SportNutritionFuelCarryingMethod;fluid_carrying_method:SportNutritionFluidCarryingMethod;planned_refill_access:SportNutritionRefillAccess;aid_station_access:SportNutritionLimitedAccessValue;aid_station_frequency_known:SportNutritionLimitedAccessValue;outside_support_access:SportNutritionLimitedAccessValue};
export type SportNutritionAthleteFuelInputs={
 recent_fluid_intake:SportNutritionHydrationValue;
 hydration_status_signal:SportNutritionHydrationValue;
 sweat_rate:SportNutritionHydrationValue;
 sodium_loss:SportNutritionHydrationValue;
 carbohydrate_tolerance_during_training:SportNutritionGutToleranceValue;
 solid_food_tolerance_during_training:SportNutritionGutToleranceValue;
 gi_distress_history_during_fueling:SportNutritionGutToleranceValue;
 gut_training_status:SportNutritionGutToleranceValue;
 known_allergies:SportNutritionDietaryRestrictionValue;
 known_intolerances:SportNutritionDietaryRestrictionValue;
 dietary_pattern_or_restriction:SportNutritionDietaryRestrictionValue;
 training_fuel_foods_cannot_or_will_not_use:SportNutritionDietaryRestrictionValue;
 gi_tolerance:'unknown';
 fueling_capability_history:'unknown';
 dietary_restrictions:'unknown';
};
export type SportNutritionContext={
 version:'sport_nutrition_context_v1';
 sport:SportNutritionSport;
 sport_source:'user_request'|'app_context';
 session_facts:SportNutritionSessionFacts|null;
 fuel_demand:SportNutritionFuelDemand;
 energy_availability_context:SportNutritionEnergyAvailabilityContext;
 recovery_timing_context:SportNutritionRecoveryTimingContext;
 pre_session_timing_context:SportNutritionPreSessionTimingContext;
 post_session_intake_context:SportNutritionPostSessionIntakeContext;
 fuel_availability_context:SportNutritionFuelAvailabilityContext;
 athlete_fuel_inputs:SportNutritionAthleteFuelInputs;
 rules:string[];
 guardrails:string[];
};

function explicitSport(text:string):SportNutritionSport|null{
 const m=normalize(text);
 if(/\b(triathlon|multisport|brick session|brick workout)\b/.test(m))return'multisport';
 if(/\b(ultra|ultramarathon|trail run|trail running|trail race|mountain run|mountain running)\b/.test(m))return'trail_ultra';
 if(/\b(cycling|cyclist|bike ride|biking|indoor trainer|trainer ride|road ride|gravel ride)\b/.test(m))return'cycling';
 if(/\b(swim|swimming|pool session|pool workout|open water)\b/.test(m))return'swimming';
 if(/\b(strength|lifting|lift|hypertrophy|powerlifting|weight training|resistance training)\b/.test(m))return'strength';
 if(/\b(ruck|rucking|hike|hiking|backpacking)\b/.test(m))return'hike_ruck';
 if(/\b(elliptical|stair stepper|stair climber|stairs workout)\b/.test(m))return'elliptical_stairs';
 if(/\b(yoga|mobility|stretch session|recovery session)\b/.test(m))return'yoga_mobility';
 if(/\b(run|running|runner|marathon|half marathon|5k|10k)\b/.test(m))return'run';
 return null;
}

function nutritionIntent(message:string,route:Route){
 if(route.workflow==='endurance_fueling_plan'||route.workflow==='endurance_fueling_explain')return true;
 const m=normalize(message);
 if(/\b(fuel|fueling|nutrition|carb|carbs|carbohydrate|carbohydrates|protein|hydrate|hydrating|hydration|sodium|electrolyte|electrolytes|eat|eating|drink|drinking)\b|\brecovery (meal|snack)\b/.test(m))return true;
 return route.workflow==='nutrition_planning'&&/\b(recipe|meal|snack)\b/.test(m)&&explicitSport(m)!==null;
}

function appContextParts(appContext:any){
 if(!appContext||typeof appContext!=='object'||Array.isArray(appContext))return{state:{},workout:{},detail:{}};
 const state=appContext.working_state&&typeof appContext.working_state==='object'&&!Array.isArray(appContext.working_state)?appContext.working_state:{};
 const workout=(state as any).planned_workout&&typeof (state as any).planned_workout==='object'&&!Array.isArray((state as any).planned_workout)?(state as any).planned_workout:{};
 const detail=(workout as any).detail&&typeof (workout as any).detail==='object'&&!Array.isArray((workout as any).detail)?(workout as any).detail:{};
 return{state,workout,detail};
}
function appContextSport(appContext:any):SportNutritionSport|null{
 const{state,workout}=appContextParts(appContext);
 const values=[(workout as any).sport,(workout as any).activityType,(workout as any).activity_type,(workout as any).type,(workout as any).title,(workout as any).label,(state as any).sport,(state as any).activity_type,(state as any).activityType,appContext?.label].filter(v=>typeof v==='string') as string[];
 for(const value of values){const sport=explicitSport(value);if(sport)return sport;}
 return null;
}
function finitePositive(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)&&value>0?value:null;}
function exactText(value:unknown,max=80):string|null{return typeof value==='string'&&value.trim()?value.replace(/[\r\n\t]+/g,' ').trim().slice(0,max):null;}
function exactBoolean(value:unknown):boolean|null{return typeof value==='boolean'?value:null;}
function exactTimeUntil(value:unknown):string|number|null{
 if(typeof value==='number'&&Number.isFinite(value)&&value>=0)return value;
 return typeof value==='string'&&value.trim()?value:null;
}
function exactEnvironmentalValue(value:unknown):SportNutritionEnvironmentalValue{
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='boolean')return value;
 return typeof value==='string'&&value.trim()?value:null;
}
function exactEnergyAvailabilityValue(value:unknown):SportNutritionEnergyAvailabilityValue{
 if(typeof value==='number'&&Number.isFinite(value))return value;
 if(typeof value==='boolean')return value;
 return typeof value==='string'&&value.trim()?value:null;
}
function exactHydrationValue(value:unknown):SportNutritionHydrationValue{
 return value===undefined||value===null||(typeof value==='string'&&!value.trim())?'unknown':value;
}
function firstHydrationValue(...values:unknown[]):SportNutritionHydrationValue{
 for(const value of values){const exact=exactHydrationValue(value);if(exact!=='unknown')return exact;}
 return'unknown';
}
function exactGutToleranceValue(value:unknown):SportNutritionGutToleranceValue{
 return value===undefined||value===null||(typeof value==='string'&&!value.trim())?'unknown':value;
}
function firstGutToleranceValue(...values:unknown[]):SportNutritionGutToleranceValue{
 for(const value of values){const exact=exactGutToleranceValue(value);if(exact!=='unknown')return exact;}
 return'unknown';
}
function exactDietaryRestrictionValue(value:unknown):SportNutritionDietaryRestrictionValue{
 return value===undefined||value===null||(typeof value==='string'&&!value.trim())?'unknown':value;
}
function firstDietaryRestrictionValue(...values:unknown[]):SportNutritionDietaryRestrictionValue{
 for(const value of values){const exact=exactDietaryRestrictionValue(value);if(exact!=='unknown')return exact;}
 return'unknown';
}
function exactAvailabilityValue(value:unknown):SportNutritionAvailabilityValue{return value==='known'||value==='unavailable'||value==='unknown'?value:'unknown';}
function exactLimitedAccessValue(value:unknown):SportNutritionLimitedAccessValue{return value==='yes'||value==='no'||value==='unknown'?value:'unknown';}
function exactFuelCarryingMethod(value:unknown):SportNutritionFuelCarryingMethod{return value==='bottle'||value==='flask'||value==='pack'||value==='pocket'||value==='aid-station'||value==='other'||value==='unknown'?value:'unknown';}
function exactFluidCarryingMethod(value:unknown):SportNutritionFluidCarryingMethod{return value==='bottle'||value==='flask'||value==='pack'||value==='aid-station'||value==='other'||value==='unknown'?value:'unknown';}
function exactRefillAccess(value:unknown):SportNutritionRefillAccess{return value==='yes'||value==='no'||value==='unknown'?value:'unknown';}
function sessionFacts(appContext:any):SportNutritionSessionFacts|null{
 const{state,workout,detail}=appContextParts(appContext);
 const sport=exactText((detail as any).sport)??exactText((workout as any).sport)??exactText((state as any).sport);
 const sessionType=exactText((detail as any).session_type)??exactText((detail as any).sessionType)??exactText((workout as any).session_type)??exactText((workout as any).sessionType);
 const durationKeys=['duration_minutes','durationMinutes','planned_duration_minutes','plannedDurationMinutes'];let duration:number|null=null;
 for(const key of durationKeys){duration=finitePositive((detail as any)[key])??finitePositive((workout as any)[key]);if(duration!==null)break;}
 const intensity=exactText((detail as any).planned_intensity)??exactText((detail as any).plannedIntensity)??exactText((detail as any).intensity)??exactText((workout as any).planned_intensity)??exactText((workout as any).plannedIntensity)??exactText((workout as any).intensity);
 const nextSessionTiming=exactText((detail as any).next_session_timing)??exactText((detail as any).nextSessionTiming)??exactText((workout as any).next_session_timing)??exactText((workout as any).nextSessionTiming)??exactText((state as any).next_session_timing)??exactText((state as any).nextSessionTiming);
 const anotherPlannedSessionSameDay=exactBoolean((detail as any).another_planned_session_same_day)??exactBoolean((detail as any).anotherPlannedSessionSameDay)??exactBoolean((workout as any).another_planned_session_same_day)??exactBoolean((workout as any).anotherPlannedSessionSameDay)??exactBoolean((state as any).another_planned_session_same_day)??exactBoolean((state as any).anotherPlannedSessionSameDay);
 const timeUntilNextSession=exactTimeUntil((detail as any).time_until_next_session)??exactTimeUntil((detail as any).timeUntilNextSession)??exactTimeUntil((workout as any).time_until_next_session)??exactTimeUntil((workout as any).timeUntilNextSession)??exactTimeUntil((state as any).time_until_next_session)??exactTimeUntil((state as any).timeUntilNextSession);
 const nextSessionSport=exactText((detail as any).next_session_sport)??exactText((detail as any).nextSessionSport)??exactText((workout as any).next_session_sport)??exactText((workout as any).nextSessionSport)??exactText((state as any).next_session_sport)??exactText((state as any).nextSessionSport);
 const nextSessionIntensity=exactText((detail as any).next_session_intensity)??exactText((detail as any).nextSessionIntensity)??exactText((workout as any).next_session_intensity)??exactText((workout as any).nextSessionIntensity)??exactText((state as any).next_session_intensity)??exactText((state as any).nextSessionIntensity);
 const sessionOccursOvernight=exactLimitedAccessValue((detail as any).session_occurs_overnight??(detail as any).sessionOccursOvernight??(workout as any).session_occurs_overnight??(workout as any).sessionOccursOvernight??(state as any).session_occurs_overnight??(state as any).sessionOccursOvernight);
 const sleepDeprivationPresent=exactLimitedAccessValue((detail as any).sleep_deprivation_present??(detail as any).sleepDeprivationPresent??(workout as any).sleep_deprivation_present??(workout as any).sleepDeprivationPresent??(state as any).sleep_deprivation_present??(state as any).sleepDeprivationPresent);
 const normalMealTimingDisrupted=exactLimitedAccessValue((detail as any).normal_meal_timing_disrupted??(detail as any).normalMealTimingDisrupted??(workout as any).normal_meal_timing_disrupted??(workout as any).normalMealTimingDisrupted??(state as any).normal_meal_timing_disrupted??(state as any).normalMealTimingDisrupted);
 const temperature=exactEnvironmentalValue((detail as any).temperature)??exactEnvironmentalValue((workout as any).temperature)??exactEnvironmentalValue((state as any).temperature);
 const humidity=exactEnvironmentalValue((detail as any).humidity)??exactEnvironmentalValue((workout as any).humidity)??exactEnvironmentalValue((state as any).humidity);
 const heatStressContext=exactEnvironmentalValue((detail as any).heat_stress_context)??exactEnvironmentalValue((detail as any).heatStressContext)??exactEnvironmentalValue((workout as any).heat_stress_context)??exactEnvironmentalValue((workout as any).heatStressContext)??exactEnvironmentalValue((state as any).heat_stress_context)??exactEnvironmentalValue((state as any).heatStressContext);
 const coldExposureContext=exactEnvironmentalValue((detail as any).cold_exposure_context)??exactEnvironmentalValue((detail as any).coldExposureContext)??exactEnvironmentalValue((workout as any).cold_exposure_context)??exactEnvironmentalValue((workout as any).coldExposureContext)??exactEnvironmentalValue((state as any).cold_exposure_context)??exactEnvironmentalValue((state as any).coldExposureContext);
 return sport!==null||sessionType!==null||duration!==null||intensity!==null||nextSessionTiming!==null||anotherPlannedSessionSameDay!==null||timeUntilNextSession!==null||nextSessionSport!==null||nextSessionIntensity!==null||temperature!==null||humidity!==null||heatStressContext!==null||coldExposureContext!==null?{sport,session_type:sessionType,duration_minutes:duration,intensity,next_session_timing:nextSessionTiming,another_planned_session_same_day:anotherPlannedSessionSameDay,time_until_next_session:timeUntilNextSession,next_session_sport:nextSessionSport,next_session_intensity:nextSessionIntensity,session_occurs_overnight:sessionOccursOvernight,sleep_deprivation_present:sleepDeprivationPresent,normal_meal_timing_disrupted:normalMealTimingDisrupted,temperature,humidity,heat_stress_context:heatStressContext,cold_exposure_context:coldExposureContext,source:'app_context'}:null;
}
function fuelDemand(facts:SportNutritionSessionFacts|null):SportNutritionFuelDemand{
 if(!facts||facts.duration_minutes===null||facts.intensity===null||facts.session_type===null)return'unknown';
 const intensity=normalize(facts.intensity),sessionType=normalize(facts.session_type),duration=facts.duration_minutes;
 const easyIntensity=/\b(easy|low|light|recovery|very light)\b/.test(intensity);
 const moderateIntensity=/\b(moderate|steady|endurance|aerobic|zone 2|z2)\b/.test(intensity);
 const hardIntensity=/\b(hard|high|threshold|tempo|interval|intervals|vo2|vo2max|race|race pace|max|maximal)\b/.test(intensity);
 const recoveryType=/\b(recovery|easy|mobility|yoga|restorative)\b/.test(sessionType);
 const moderateType=/\b(steady|endurance|base|general|strength|hypertrophy|technique|drill|drills)\b/.test(sessionType);
 const hardType=/\b(interval|intervals|threshold|tempo|vo2|race|race pace|long|brick)\b/.test(sessionType);
 if(!(easyIntensity||moderateIntensity||hardIntensity)||!(recoveryType||moderateType||hardType))return'unknown';
 if(duration<=60&&easyIntensity&&recoveryType)return'minimal';
 if((duration>=120&&(hardIntensity||hardType))||(duration>=180&&moderateIntensity&&!recoveryType)||(duration>=60&&hardIntensity&&hardType))return'high';
 return'moderate';
}
function energyAvailabilityContext(appContext:any):SportNutritionEnergyAvailabilityContext{
 const{state,workout,detail}=appContextParts(appContext);
 const lowEnergyAvailabilityRedsRisk=exactEnergyAvailabilityValue((detail as any).low_energy_availability_reds_risk)??exactEnergyAvailabilityValue((detail as any).lowEnergyAvailabilityRedsRisk)??exactEnergyAvailabilityValue((detail as any).low_energy_availability_risk)??exactEnergyAvailabilityValue((detail as any).lowEnergyAvailabilityRisk)??exactEnergyAvailabilityValue((detail as any).reds_risk)??exactEnergyAvailabilityValue((detail as any).redsRisk)??exactEnergyAvailabilityValue((workout as any).low_energy_availability_reds_risk)??exactEnergyAvailabilityValue((workout as any).lowEnergyAvailabilityRedsRisk)??exactEnergyAvailabilityValue((workout as any).low_energy_availability_risk)??exactEnergyAvailabilityValue((workout as any).lowEnergyAvailabilityRisk)??exactEnergyAvailabilityValue((workout as any).reds_risk)??exactEnergyAvailabilityValue((workout as any).redsRisk)??exactEnergyAvailabilityValue((state as any).low_energy_availability_reds_risk)??exactEnergyAvailabilityValue((state as any).lowEnergyAvailabilityRedsRisk)??exactEnergyAvailabilityValue((state as any).low_energy_availability_risk)??exactEnergyAvailabilityValue((state as any).lowEnergyAvailabilityRisk)??exactEnergyAvailabilityValue((state as any).reds_risk)??exactEnergyAvailabilityValue((state as any).redsRisk);
 const recentIntakeInsufficiency=exactEnergyAvailabilityValue((detail as any).recent_intake_insufficiency)??exactEnergyAvailabilityValue((detail as any).recentIntakeInsufficiency)??exactEnergyAvailabilityValue((detail as any).recent_intake_insufficiency_signal)??exactEnergyAvailabilityValue((detail as any).recentIntakeInsufficiencySignal)??exactEnergyAvailabilityValue((workout as any).recent_intake_insufficiency)??exactEnergyAvailabilityValue((workout as any).recentIntakeInsufficiency)??exactEnergyAvailabilityValue((workout as any).recent_intake_insufficiency_signal)??exactEnergyAvailabilityValue((workout as any).recentIntakeInsufficiencySignal)??exactEnergyAvailabilityValue((state as any).recent_intake_insufficiency)??exactEnergyAvailabilityValue((state as any).recentIntakeInsufficiency)??exactEnergyAvailabilityValue((state as any).recent_intake_insufficiency_signal)??exactEnergyAvailabilityValue((state as any).recentIntakeInsufficiencySignal);
 const highTrainingLoadLowFuelingContext=exactEnergyAvailabilityValue((detail as any).high_training_load_low_fueling_context)??exactEnergyAvailabilityValue((detail as any).highTrainingLoadLowFuelingContext)??exactEnergyAvailabilityValue((detail as any).high_training_load_low_fueling)??exactEnergyAvailabilityValue((detail as any).highTrainingLoadLowFueling)??exactEnergyAvailabilityValue((workout as any).high_training_load_low_fueling_context)??exactEnergyAvailabilityValue((workout as any).highTrainingLoadLowFuelingContext)??exactEnergyAvailabilityValue((workout as any).high_training_load_low_fueling)??exactEnergyAvailabilityValue((workout as any).highTrainingLoadLowFueling)??exactEnergyAvailabilityValue((state as any).high_training_load_low_fueling_context)??exactEnergyAvailabilityValue((state as any).highTrainingLoadLowFuelingContext)??exactEnergyAvailabilityValue((state as any).high_training_load_low_fueling)??exactEnergyAvailabilityValue((state as any).highTrainingLoadLowFueling);
 return{low_energy_availability_reds_risk:lowEnergyAvailabilityRedsRisk,recent_intake_insufficiency:recentIntakeInsufficiency,high_training_load_low_fueling_context:highTrainingLoadLowFuelingContext};
}
function recoveryTimingContext(appContext:any):SportNutritionRecoveryTimingContext{
 const{state,workout,detail}=appContextParts(appContext);
 const timeSinceCompletedSession=exactTimeUntil((detail as any).time_since_completed_session)??exactTimeUntil((detail as any).timeSinceCompletedSession)??exactTimeUntil((workout as any).time_since_completed_session)??exactTimeUntil((workout as any).timeSinceCompletedSession)??exactTimeUntil((state as any).time_since_completed_session)??exactTimeUntil((state as any).timeSinceCompletedSession);
 const anotherPlannedSessionWithin4Hours=exactBoolean((detail as any).another_planned_session_within_4_hours)??exactBoolean((detail as any).anotherPlannedSessionWithin4Hours)??exactBoolean((workout as any).another_planned_session_within_4_hours)??exactBoolean((workout as any).anotherPlannedSessionWithin4Hours)??exactBoolean((state as any).another_planned_session_within_4_hours)??exactBoolean((state as any).anotherPlannedSessionWithin4Hours);
 const anotherPlannedSessionLaterSameDay=exactBoolean((detail as any).another_planned_session_later_same_day)??exactBoolean((detail as any).anotherPlannedSessionLaterSameDay)??exactBoolean((workout as any).another_planned_session_later_same_day)??exactBoolean((workout as any).anotherPlannedSessionLaterSameDay)??exactBoolean((state as any).another_planned_session_later_same_day)??exactBoolean((state as any).anotherPlannedSessionLaterSameDay);
 const nextPlannedSessionFollowingDay=exactBoolean((detail as any).next_planned_session_following_day)??exactBoolean((detail as any).nextPlannedSessionFollowingDay)??exactBoolean((workout as any).next_planned_session_following_day)??exactBoolean((workout as any).nextPlannedSessionFollowingDay)??exactBoolean((state as any).next_planned_session_following_day)??exactBoolean((state as any).nextPlannedSessionFollowingDay);
 return{time_since_completed_session:timeSinceCompletedSession,another_planned_session_within_4_hours:anotherPlannedSessionWithin4Hours,another_planned_session_later_same_day:anotherPlannedSessionLaterSameDay,next_planned_session_following_day:nextPlannedSessionFollowingDay};
}
function preSessionTimingContext(appContext:any):SportNutritionPreSessionTimingContext{
 const{state,workout,detail}=appContextParts(appContext);
 const timeUntilPlannedSession=exactTimeUntil((detail as any).time_until_planned_session)??exactTimeUntil((detail as any).timeUntilPlannedSession)??exactTimeUntil((detail as any).time_until_session_start)??exactTimeUntil((detail as any).timeUntilSessionStart)??exactTimeUntil((workout as any).time_until_planned_session)??exactTimeUntil((workout as any).timeUntilPlannedSession)??exactTimeUntil((workout as any).time_until_session_start)??exactTimeUntil((workout as any).timeUntilSessionStart)??exactTimeUntil((state as any).time_until_planned_session)??exactTimeUntil((state as any).timeUntilPlannedSession)??exactTimeUntil((state as any).time_until_session_start)??exactTimeUntil((state as any).timeUntilSessionStart);
 const ateRecently=exactBoolean((detail as any).ate_recently)??exactBoolean((detail as any).ateRecently)??exactBoolean((detail as any).has_eaten_recently)??exactBoolean((detail as any).hasEatenRecently)??exactBoolean((workout as any).ate_recently)??exactBoolean((workout as any).ateRecently)??exactBoolean((workout as any).has_eaten_recently)??exactBoolean((workout as any).hasEatenRecently)??exactBoolean((state as any).ate_recently)??exactBoolean((state as any).ateRecently)??exactBoolean((state as any).has_eaten_recently)??exactBoolean((state as any).hasEatenRecently);
 const timeSinceLastMealOrSnack=exactTimeUntil((detail as any).time_since_last_meal_or_snack)??exactTimeUntil((detail as any).timeSinceLastMealOrSnack)??exactTimeUntil((workout as any).time_since_last_meal_or_snack)??exactTimeUntil((workout as any).timeSinceLastMealOrSnack)??exactTimeUntil((state as any).time_since_last_meal_or_snack)??exactTimeUntil((state as any).timeSinceLastMealOrSnack);
 return{time_until_planned_session:timeUntilPlannedSession,ate_recently:ateRecently,time_since_last_meal_or_snack:timeSinceLastMealOrSnack};
}
function postSessionIntakeContext(appContext:any):SportNutritionPostSessionIntakeContext{
 const{state,workout,detail}=appContextParts(appContext);
 const ateSinceSession=exactBoolean((detail as any).ate_since_session)??exactBoolean((detail as any).ateSinceSession)??exactBoolean((detail as any).has_eaten_since_session)??exactBoolean((detail as any).hasEatenSinceSession)??exactBoolean((workout as any).ate_since_session)??exactBoolean((workout as any).ateSinceSession)??exactBoolean((workout as any).has_eaten_since_session)??exactBoolean((workout as any).hasEatenSinceSession)??exactBoolean((state as any).ate_since_session)??exactBoolean((state as any).ateSinceSession)??exactBoolean((state as any).has_eaten_since_session)??exactBoolean((state as any).hasEatenSinceSession);
 const timeSinceFirstPostSessionMealOrSnack=exactTimeUntil((detail as any).time_since_first_post_session_meal_or_snack)??exactTimeUntil((detail as any).timeSinceFirstPostSessionMealOrSnack)??exactTimeUntil((workout as any).time_since_first_post_session_meal_or_snack)??exactTimeUntil((workout as any).timeSinceFirstPostSessionMealOrSnack)??exactTimeUntil((state as any).time_since_first_post_session_meal_or_snack)??exactTimeUntil((state as any).timeSinceFirstPostSessionMealOrSnack);
 return{ate_since_session:ateSinceSession,time_since_first_post_session_meal_or_snack:timeSinceFirstPostSessionMealOrSnack,intake_unknown:ateSinceSession===null&&timeSinceFirstPostSessionMealOrSnack===null};
}
function fuelAvailabilityContext(appContext:any):SportNutritionFuelAvailabilityContext{
 const{state,workout,detail}=appContextParts(appContext);
 return{
  planned_training_fuel_available:exactAvailabilityValue((detail as any).planned_training_fuel_available??(detail as any).plannedTrainingFuelAvailable??(workout as any).planned_training_fuel_available??(workout as any).plannedTrainingFuelAvailable??(state as any).planned_training_fuel_available??(state as any).plannedTrainingFuelAvailable),
  fluids_available_during_session:exactAvailabilityValue((detail as any).fluids_available_during_session??(detail as any).fluidsAvailableDuringSession??(workout as any).fluids_available_during_session??(workout as any).fluidsAvailableDuringSession??(state as any).fluids_available_during_session??(state as any).fluidsAvailableDuringSession),
  refueling_access_limited:exactLimitedAccessValue((detail as any).refueling_access_limited??(detail as any).refuelingAccessLimited??(workout as any).refueling_access_limited??(workout as any).refuelingAccessLimited??(state as any).refueling_access_limited??(state as any).refuelingAccessLimited),
  fuel_carrying_method:exactFuelCarryingMethod((detail as any).fuel_carrying_method??(detail as any).fuelCarryingMethod??(workout as any).fuel_carrying_method??(workout as any).fuelCarryingMethod??(state as any).fuel_carrying_method??(state as any).fuelCarryingMethod),
  fluid_carrying_method:exactFluidCarryingMethod((detail as any).fluid_carrying_method??(detail as any).fluidCarryingMethod??(workout as any).fluid_carrying_method??(workout as any).fluidCarryingMethod??(state as any).fluid_carrying_method??(state as any).fluidCarryingMethod),
  planned_refill_access:exactRefillAccess((detail as any).planned_refill_access??(detail as any).plannedRefillAccess??(workout as any).planned_refill_access??(workout as any).plannedRefillAccess??(state as any).planned_refill_access??(state as any).plannedRefillAccess),
  aid_station_access:exactLimitedAccessValue((detail as any).aid_station_access??(detail as any).aidStationAccess??(workout as any).aid_station_access??(workout as any).aidStationAccess??(state as any).aid_station_access??(state as any).aidStationAccess),
  aid_station_frequency_known:exactLimitedAccessValue((detail as any).aid_station_frequency_known??(detail as any).aidStationFrequencyKnown??(workout as any).aid_station_frequency_known??(workout as any).aidStationFrequencyKnown??(state as any).aid_station_frequency_known??(state as any).aidStationFrequencyKnown),
  outside_support_access:exactLimitedAccessValue((detail as any).outside_support_access??(detail as any).outsideSupportAccess??(workout as any).outside_support_access??(workout as any).outsideSupportAccess??(state as any).outside_support_access??(state as any).outsideSupportAccess),
 };
}
function athleteFuelInputs(appContext:any):SportNutritionAthleteFuelInputs{
 const{state,workout,detail}=appContextParts(appContext);
 return{
  recent_fluid_intake:firstHydrationValue((detail as any).recent_fluid_intake,(detail as any).recentFluidIntake,(workout as any).recent_fluid_intake,(workout as any).recentFluidIntake,(state as any).recent_fluid_intake,(state as any).recentFluidIntake),
  hydration_status_signal:firstHydrationValue((detail as any).hydration_status_signal,(detail as any).hydrationStatusSignal,(workout as any).hydration_status_signal,(workout as any).hydrationStatusSignal,(state as any).hydration_status_signal,(state as any).hydrationStatusSignal),
  sweat_rate:firstHydrationValue((detail as any).sweat_rate_estimate,(detail as any).sweatRateEstimate,(workout as any).sweat_rate_estimate,(workout as any).sweatRateEstimate,(state as any).sweat_rate_estimate,(state as any).sweatRateEstimate),
  sodium_loss:firstHydrationValue((detail as any).sodium_loss_estimate,(detail as any).sodiumLossEstimate,(workout as any).sodium_loss_estimate,(workout as any).sodiumLossEstimate,(state as any).sodium_loss_estimate,(state as any).sodiumLossEstimate),
  carbohydrate_tolerance_during_training:firstGutToleranceValue((detail as any).carbohydrate_tolerance_during_training,(detail as any).carbohydrateToleranceDuringTraining,(workout as any).carbohydrate_tolerance_during_training,(workout as any).carbohydrateToleranceDuringTraining,(state as any).carbohydrate_tolerance_during_training,(state as any).carbohydrateToleranceDuringTraining),
  solid_food_tolerance_during_training:firstGutToleranceValue((detail as any).solid_food_tolerance_during_training,(detail as any).solidFoodToleranceDuringTraining,(workout as any).solid_food_tolerance_during_training,(workout as any).solidFoodToleranceDuringTraining,(state as any).solid_food_tolerance_during_training,(state as any).solidFoodToleranceDuringTraining),
  gi_distress_history_during_fueling:firstGutToleranceValue((detail as any).gi_distress_history_during_fueling,(detail as any).giDistressHistoryDuringFueling,(workout as any).gi_distress_history_during_fueling,(workout as any).giDistressHistoryDuringFueling,(state as any).gi_distress_history_during_fueling,(state as any).giDistressHistoryDuringFueling),
  gut_training_status:firstGutToleranceValue((detail as any).gut_training_status,(detail as any).gutTrainingStatus,(workout as any).gut_training_status,(workout as any).gutTrainingStatus,(state as any).gut_training_status,(state as any).gutTrainingStatus),
  known_allergies:firstDietaryRestrictionValue((detail as any).known_allergies,(detail as any).knownAllergies,(workout as any).known_allergies,(workout as any).knownAllergies,(state as any).known_allergies,(state as any).knownAllergies),
  known_intolerances:firstDietaryRestrictionValue((detail as any).known_intolerances,(detail as any).knownIntolerances,(workout as any).known_intolerances,(workout as any).knownIntolerances,(state as any).known_intolerances,(state as any).knownIntolerances),
  dietary_pattern_or_restriction:firstDietaryRestrictionValue((detail as any).dietary_pattern_or_restriction,(detail as any).dietaryPatternOrRestriction,(detail as any).dietary_restrictions,(detail as any).dietaryRestrictions,(workout as any).dietary_pattern_or_restriction,(workout as any).dietaryPatternOrRestriction,(workout as any).dietary_restrictions,(workout as any).dietaryRestrictions,(state as any).dietary_pattern_or_restriction,(state as any).dietaryPatternOrRestriction,(state as any).dietary_restrictions,(state as any).dietaryRestrictions),
  training_fuel_foods_cannot_or_will_not_use:firstDietaryRestrictionValue((detail as any).training_fuel_foods_cannot_or_will_not_use,(detail as any).trainingFuelFoodsCannotOrWillNotUse,(workout as any).training_fuel_foods_cannot_or_will_not_use,(workout as any).trainingFuelFoodsCannotOrWillNotUse,(state as any).training_fuel_foods_cannot_or_will_not_use,(state as any).trainingFuelFoodsCannotOrWillNotUse),
  gi_tolerance:'unknown',
  fueling_capability_history:'unknown',
  dietary_restrictions:'unknown',
 };
}

function sportRules(sport:SportNutritionSport):string[]{
 switch(sport){
  case'run':return[
   'Running Fuel should follow session demand: easy/recovery running, quality work, long running and race preparation are not one fueling problem.',
   'Protect carbohydrate availability around long or high-quality running when supplied training context shows meaningful glycogen demand; do not prescribe race-style in-session Fuel for every short easy run.',
  ];
  case'trail_ultra':return[
   'Trail/ultra Fuel must account for long duration, terrain, carrying/aid-station logistics, GI tolerance, palatability and practical food variety rather than carbohydrate numbers alone.',
   'Climbing, descending and technical terrain can reduce intake opportunities; do not assume road-running delivery patterns transfer unchanged.',
   'Gut-training and repeated personal tolerance evidence may inform execution, but one successful or failed food choice is not a universal rule.',
  ];
  case'cycling':return[
   'Cycling Fuel should reflect discipline, intensity, duration and delivery logistics; short hard trainer work and long outdoor endurance/race riding are not equivalent.',
   'For indoor trainer sessions, airflow and thermal load can materially change fluid needs even when the workout is shorter or stationary.',
   'Use on-bike Fuel targets only when a canonical reviewed fueling plan supplies them; do not freehand high-carbohydrate race targets from general cycling knowledge.',
  ];
  case'swimming':return[
   'Swimming Nutrition should account for training volume and intensity even when eating or drinking during the main set is impractical.',
   'Pre-session and post-session Fuel can be more important than in-session delivery for many pool sessions; do not interpret limited in-water intake opportunity as low energy demand.',
   'For long sessions, meets, heats or open-water events, use supplied competition/session context rather than inventing poolside or in-water intake logistics.',
  ];
  case'strength':return[
   'Strength Nutrition should prioritize adequate total energy, protein/recovery support and carbohydrate availability when session volume or intensity makes it relevant.',
   'Do not apply endurance hourly fueling logic to ordinary lifting sessions solely because Training is in progress.',
   'On concurrent endurance + Strength days, account for both demands without double-counting the same Training energy or recovery requirement.',
  ];
  case'multisport':return[
   'Multisport/brick Fuel should treat the combined session or race as one energy-and-hydration problem with discipline transitions and delivery logistics.',
   'Do not calculate each discipline independently and then double-count overlapping carbohydrate, fluid, recovery or exercise-energy needs.',
   'When another session is near, recovery timing becomes more relevant than it is after an isolated session.',
  ];
  case'hike_ruck':return[
   'Hike/ruck Fuel should follow actual duration, load carriage, elevation, intensity and environment rather than generic walking rules.',
   'Do not convert hiking or rucking into fake running-equivalent calorie or Fuel requirements.',
  ];
  case'elliptical_stairs':return[
   'Elliptical/stair-stepper Fuel may use general duration/intensity endurance logic when appropriate; there is no need to invent a special sport-specific Fuel system.',
   'Do not create running-equivalent distance, calorie or Fuel assumptions for these modalities.',
  ];
  case'yoga_mobility':return[
   'Short yoga, mobility and recovery sessions normally do not justify special in-session sports-food recommendations by themselves.',
   'General energy availability and hydration still matter, but do not manufacture a workout-fueling task when none is supported.',
  ];
 }
}

export function buildSportNutritionContext(message:string,route:Route,appContext:unknown):SportNutritionContext|null{
 if(!nutritionIntent(message,route))return null;
 const requestSport=explicitSport(message),contextSport=appContextSport(appContext),sport=requestSport??contextSport;
 if(!sport)return null;
 const rules=sportRules(sport),facts=!requestSport||requestSport===contextSport?sessionFacts(appContext):null;
 const energyAvailability=energyAvailabilityContext(appContext),recoveryTiming=recoveryTimingContext(appContext),preSessionTiming=preSessionTimingContext(appContext),postSessionIntake=postSessionIntakeContext(appContext),fuelAvailability=fuelAvailabilityContext(appContext),fuelInputs=athleteFuelInputs(appContext);
 const m=normalize(message);
 if(/\b(hot|heat|humid|humidity)\b/.test(m))rules.push('Hot/humid conditions can increase fluid demand, but use measured/supplied hydration evidence rather than assuming sweat rate or sodium loss.');
 if(/\b(cold|winter|snow|freezing)\b/.test(m))rules.push('Cold conditions can change drinking behavior and practical Fuel access; do not assume hydration need is zero because thirst is lower.');
 if(/\b(two[- ]a[- ]day|two sessions|back[- ]to[- ]back|another session|second session)\b/.test(m))rules.push('A nearby second session increases the importance of recovery timing and replenishment; use the actual schedule when supplied.');
 return{
  version:'sport_nutrition_context_v1',sport,sport_source:requestSport?'user_request':'app_context',session_facts:facts,fuel_demand:fuelDemand(facts),energy_availability_context:energyAvailability,recovery_timing_context:recoveryTiming,pre_session_timing_context:preSessionTiming,post_session_intake_context:postSessionIntake,fuel_availability_context:fuelAvailability,athlete_fuel_inputs:fuelInputs,
  rules:[...new Set(rules)],
  guardrails:[
   'Session facts contain only exact structured values from the attached Training object. Missing values remain unknown; never infer session type, intensity, another session, next-session timing, next-session sport, next-session intensity, session occurs overnight, sleep deprivation present, normal meal timing disrupted, or environmental context from sport/duration/calendar gaps, and never parse formatted duration copy into numeric facts. Session-occurs-overnight is pass-through only and must not be inferred from start time, duration, race distance, sport or event type. Sleep-deprivation-present is pass-through only and must not be inferred from overnight status, race distance, duration, sport or event type; it must not generate caffeine recommendations, food recommendations, targets or calculations. Normal-meal-timing-disrupted is pass-through only and must not be inferred from overnight status, race distance, duration, sport or event type; it must not generate caffeine recommendations, food recommendations, targets or calculations.',
   'Fuel-demand classification uses only explicit session duration, intensity and session type. If any required input is missing or unrecognized, fuel_demand remains unknown. It does not create carbohydrate, calorie, fluid, sodium or protein targets or sport-specific recommendations.',
   'Multi-session facts are schedule context only; do not convert them into duplicate exercise calories or duplicate Fuel needs.',
   'Recovery-timing context is pass-through only. Known values stay exact and missing values stay unknown; do not infer recovery urgency from sport alone or create carbohydrate, protein or fluid targets from timing context.',
   'Pre-session timing context is pass-through only. Known time until the planned session, explicit recent-eating status, and known time since the last meal/snack stay unchanged; missing values stay unknown. Do not infer meal timing from Food Log gaps, generate pre-session food recommendations, calculate carbohydrate or calorie targets, or create sport-specific Nutrition rules here.',
   'Post-session intake context is pass-through only. Explicit eaten-since-session status and known time since the first post-session meal/snack stay unchanged; missing intake evidence stays unknown. Do not infer post-session intake from Food Log gaps, generate recovery meal recommendations, calculate carbohydrate, protein or calorie targets, or create sport-specific Nutrition rules here.',
   'Fuel-availability context is pass-through only. Explicit planned training Fuel availability, fluids-during-session availability, refueling-access limitation, Fuel carrying method, fluid carrying method, planned refill access, aid-station access, aid-station frequency-known status, and outside-support access stay unchanged; missing values remain unknown. Do not infer access or carrying/refill logistics from sport, venue, duration, distance, race type or session type, generate product or food recommendations, or calculate carbohydrate, fluid or sodium targets here.',
   'Environmental facts are context only; weather alone must not infer sweat rate, sodium loss, or numerical fluid, sodium, carbohydrate or calorie targets.',
   'Hydration inputs are pass-through only. Known recent fluid intake, hydration-status, sweat-rate estimate and sodium-loss estimate stay unchanged; missing values stay unknown. Do not infer sweat rate from weather, body size or sport, do not infer sodium loss from sweat rate alone, and do not calculate fluid or sodium targets here.',
   'GI-tolerance inputs are pass-through only. Known carbohydrate tolerance during training, solid-food tolerance during training, GI-distress history during fueling and explicitly recorded gut-training status stay unchanged; missing values stay unknown. Do not infer tolerance or gut-training status from prior duration or sport, prescribe carbohydrate ranges, recommend solids versus liquids, or create sport-specific fueling rules here.',
   'Dietary-restriction inputs are pass-through only. Known allergies, intolerances, explicitly recorded dietary pattern/restriction, and foods the athlete cannot or will not use for training Fuel stay unchanged; missing values stay unknown. Do not infer restrictions from meal history alone, generate replacement foods, or create sport-specific fueling rules here.',
   'Energy-availability context is pass-through only. Do not diagnose REDs, infer low energy availability from body weight, sex, or sport alone, or create calorie targets from these signals.',
   'Exact endurance carbohydrate, fluid and sodium targets must come from canonical_endurance_fueling_plan when supplied; never manufacture numerical hourly targets.',
   'Unknown sweat rate, sodium loss, GI tolerance, fueling capability/history and dietary restrictions remain unknown.',
   'Protect adequate energy availability; do not recommend chronic under-fueling or aggressive restriction to improve performance.',
   'Health-condition-specific Nutrition advice remains under the existing health-safety boundary rather than this sport context.',
  ],
 };
}