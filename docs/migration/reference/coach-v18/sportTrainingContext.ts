import type {Route} from './core.ts';
import {normalize} from './core.ts';

export type CoachTrainingSport='road_run'|'trail_mountain'|'cycling'|'swimming'|'strength'|'multisport'|'hike_ruck'|'elliptical_stairs'|'yoga_mobility';
export type CoachEnvironmentSignal='heat_humidity'|'cold'|'wet'|'wind'|'snow_ice'|'low_light';
export type RoadRunEvent='beginner_return'|'5k'|'10k'|'half_marathon'|'marathon'|'road_ultra'|'unknown';
export type SportTrainingSessionFacts={
 duration_minutes:number|null;
 elevation_gain_feet:number|null;
 elevation_gain_meters:number|null;
 pack_weight_lb:number|null;
 pack_weight_kg:number|null;
 terrain:string|null;
 surface:string|null;
 source:'app_context';
};
export type EnvironmentPrecipitation='none'|'rain'|'snow'|'sleet'|'mixed'|'unknown';
export type EnvironmentWetness='dry'|'wet'|'unknown';
export type EnvironmentFooting='clear'|'slippery'|'unknown';
export type EnvironmentPresence='present'|'absent'|'unknown';
export type EnvironmentDaylight='daylight'|'darkness'|'unknown';
export type StructuredEnvironmentContext={
 temperature_c:number|null;
 temperature_f:number|null;
 humidity_percent:number|null;
 wind_speed_mph:number|null;
 wind_speed_kph:number|null;
 wind_chill_c:number|null;
 wind_chill_f:number|null;
 precipitation:EnvironmentPrecipitation;
 wetness:EnvironmentWetness;
 footing:EnvironmentFooting;
 ice_risk:EnvironmentPresence;
 daylight:EnvironmentDaylight;
 heat_exposure:EnvironmentPresence;
 source:'app_context';
};
export type EnvironmentAdaptationAction='preserve_planned_session'|'modify_execution'|'suggest_indoor_substitution'|'flag_safety_concern'|'insufficient_context';
export type EnvironmentAdaptationDecision={
 action:EnvironmentAdaptationAction;
 reasons:string[];
 automatic_training_rewrite:false;
 change_of_plans_owner:'existing_training_change_of_plans';
 plan_mutation_policy:'existing_preview_confirm_apply_only';
};
export type SportTrainingContext={
 version:'sport_training_context_v1';
 sport:CoachTrainingSport|null;
 sport_source:'user_request'|'app_context'|null;
 road_run_event:RoadRunEvent|null;
 session_facts:SportTrainingSessionFacts|null;
 environment_signals:CoachEnvironmentSignal[];
 environment_context:StructuredEnvironmentContext|null;
 environment_decision:EnvironmentAdaptationDecision|null;
 environment_guidance:string[];
 rules:string[];
 guardrails:string[];
};

const relevant=(message:string,route:Route)=>['adaptive_coaching','long_range_training_plan','workout_analysis','race_execution'].includes(route.workflow)||/\b(train|training|workout|work out|session|run|running|ride|cycling|swim|swimming|strength|lift|lifting|trail|ultra|hike|hiking|ruck|rucking|elliptical|stair|stairs|yoga|weather|heat|hot|humid|humidity|cold|wind|windy|rain|raining|snow|ice|icy|dark|darkness|daylight|indoors|treadmill|trainer)\b/.test(normalize(message));

function explicitSport(text:string):CoachTrainingSport|null{
 const m=normalize(text);
 if(/\b(triathlon|multisport|brick session|brick workout)\b/.test(m))return'multisport';
 if(/\b(road ultra|road ultramarathon|road 50k|road 50 mile|road 100k|road 100 mile)\b/.test(m))return'road_run';
 if(/\b(ultra|ultramarathon|trail run|trail running|mountain run|mountain running)\b/.test(m))return'trail_mountain';
 if(/\b(cycling|cyclist|bike ride|biking|indoor trainer|trainer ride|road ride|gravel ride)\b/.test(m))return'cycling';
 if(/\b(swim|swimming|pool session|open water)\b/.test(m))return'swimming';
 if(/\b(strength|lifting|lift|hypertrophy|powerlifting|weight training|resistance training)\b/.test(m))return'strength';
 if(/\b(ruck|rucking|hike|hiking|backpacking)\b/.test(m))return'hike_ruck';
 if(/\b(elliptical|stair stepper|stair climber|stairs workout)\b/.test(m))return'elliptical_stairs';
 if(/\b(yoga|mobility|stretch session)\b/.test(m))return'yoga_mobility';
 if(/\b(run|running|runner|marathon|half marathon|5k|10k)\b/.test(m))return'road_run';
 return null;
}

function appContextParts(appContext:any){
 if(!appContext||typeof appContext!=='object'||Array.isArray(appContext))return{state:{},workout:{},detail:{}};
 const state=appContext.working_state&&typeof appContext.working_state==='object'&&!Array.isArray(appContext.working_state)?appContext.working_state:{};
 const workout=(state as any).planned_workout&&typeof (state as any).planned_workout==='object'&&!Array.isArray((state as any).planned_workout)?(state as any).planned_workout:{};
 const detail=(workout as any).detail&&typeof (workout as any).detail==='object'&&!Array.isArray((workout as any).detail)?(workout as any).detail:{};
 return{state,workout,detail};
}
function contextSport(appContext:any):CoachTrainingSport|null{
 const{state,workout}=appContextParts(appContext);
 const values=[(workout as any).sport,(workout as any).activityType,(workout as any).activity_type,(workout as any).type,(workout as any).title,(workout as any).label,(state as any).sport,(state as any).activity_type,(state as any).activityType,appContext?.label].filter(v=>typeof v==='string') as string[];
 for(const value of values){const sport=explicitSport(value);if(sport)return sport;}
 return null;
}
function roadRunEvent(message:string,appContext:any):RoadRunEvent{
 const{state,workout,detail}=appContextParts(appContext);
 const contextValues=[(state as any).goal,(state as any).target_event,(state as any).targetEvent,(state as any).race_distance,(state as any).raceDistance,(workout as any).goal,(workout as any).target_event,(workout as any).targetEvent,(workout as any).title,(workout as any).label,(detail as any).goal,(detail as any).target_event,(detail as any).targetEvent,appContext?.label].filter(v=>typeof v==='string') as string[];
 const text=normalize([message,...contextValues].join(' '));
 if(/\b(beginner|new runner|couch to 5k|return to running|returning to running|coming back to running|restart running)\b/.test(text))return'beginner_return';
 if(/\broad (ultra|ultramarathon|50k|50 mile|100k|100 mile)\b/.test(text))return'road_ultra';
 if(/\bhalf marathon\b/.test(text))return'half_marathon';
 if(/\bmarathon\b/.test(text))return'marathon';
 if(/\b10k\b/.test(text))return'10k';
 if(/\b5k\b/.test(text))return'5k';
 return'unknown';
}
function finiteNumber(value:unknown):number|null{return typeof value==='number'&&Number.isFinite(value)?value:null;}
function finiteNonnegative(value:unknown):number|null{const valueNumber=finiteNumber(value);return valueNumber!==null&&valueNumber>=0?valueNumber:null;}
function finitePositive(value:unknown):number|null{const valueNumber=finiteNumber(value);return valueNumber!==null&&valueNumber>0?valueNumber:null;}
function exactText(value:unknown,max=120):string|null{return typeof value==='string'&&value.trim()?value.replace(/[\r\n\t]+/g,' ').trim().slice(0,max):null;}
function firstNumber(sources:Record<string,unknown>[],keys:string[],positive=true){for(const source of sources)for(const key of keys){const value=positive?finitePositive(source[key]):finiteNonnegative(source[key]);if(value!==null)return value;}return null;}
function firstFiniteNumber(sources:Record<string,unknown>[],keys:string[]){for(const source of sources)for(const key of keys){const value=finiteNumber(source[key]);if(value!==null)return value;}return null;}
function firstText(sources:Record<string,unknown>[],keys:string[]){for(const source of sources)for(const key of keys){const value=exactText(source[key]);if(value)return value;}return null;}
function firstBoolean(sources:Record<string,unknown>[],keys:string[]):boolean|null{for(const source of sources)for(const key of keys)if(typeof source[key]==='boolean')return source[key] as boolean;return null;}
function sessionFacts(appContext:any):SportTrainingSessionFacts|null{
 const{workout,detail}=appContextParts(appContext),sources=[detail as Record<string,unknown>,workout as Record<string,unknown>];
 const facts:SportTrainingSessionFacts={
  duration_minutes:firstNumber(sources,['duration_minutes','durationMinutes','planned_duration_minutes','plannedDurationMinutes']),
  elevation_gain_feet:firstNumber(sources,['elevation_gain_feet','elevationGainFeet'],false),
  elevation_gain_meters:firstNumber(sources,['elevation_gain_meters','elevationGainMeters'],false),
  pack_weight_lb:firstNumber(sources,['pack_weight_lb','packWeightLb'],false),
  pack_weight_kg:firstNumber(sources,['pack_weight_kg','packWeightKg'],false),
  terrain:firstText(sources,['terrain']),surface:firstText(sources,['surface']),source:'app_context',
 };
 return Object.entries(facts).some(([key,value])=>key!=='source'&&value!==null)?facts:null;
}

function environmentSignals(message:string):CoachEnvironmentSignal[]{
 const m=normalize(message),out:CoachEnvironmentSignal[]=[];
 if(/\b(heat|hot|humid|humidity)\b/.test(m))out.push('heat_humidity');
 if(/\b(cold|freezing|wind chill)\b/.test(m))out.push('cold');
 if(/\b(rain|raining|wet|precipitation|sleet)\b/.test(m))out.push('wet');
 if(/\b(wind|windy|gust|gusty)\b/.test(m))out.push('wind');
 if(/\b(snow|ice|icy|black ice|slick footing)\b/.test(m))out.push('snow_ice');
 if(/\b(dark|darkness|low light|daylight|night run|night ride)\b/.test(m))out.push('low_light');
 return [...new Set(out)];
}
function environmentSources(appContext:any):Record<string,unknown>[] {
 const{state,workout}=appContextParts(appContext);
 const candidates=[(state as any).environment_context,(state as any).environment,(workout as any).environment_context,(workout as any).environment,appContext?.environment_context,appContext?.environment];
 return candidates.filter(value=>value&&typeof value==='object'&&!Array.isArray(value)) as Record<string,unknown>[];
}
function enumValue<T extends string>(sources:Record<string,unknown>[],keys:string[],map:Record<string,T>):T|'unknown'{
 const value=firstText(sources,keys)?.toLowerCase().replace(/[ -]+/g,'_');
 return value&&map[value]?map[value]:'unknown';
}
function structuredEnvironmentContext(appContext:any):StructuredEnvironmentContext|null{
 const sources=environmentSources(appContext);
 if(!sources.length)return null;
 const humidity=firstFiniteNumber(sources,['humidity_percent','humidityPercent']);
 const iceRisk=firstBoolean(sources,['ice_risk','iceRisk']);
 const heatExposure=firstBoolean(sources,['heat_exposure','heatExposure']);
 return{
  temperature_c:firstFiniteNumber(sources,['temperature_c','temperatureC']),
  temperature_f:firstFiniteNumber(sources,['temperature_f','temperatureF']),
  humidity_percent:humidity!==null&&humidity>=0&&humidity<=100?humidity:null,
  wind_speed_mph:firstNumber(sources,['wind_speed_mph','windSpeedMph'],false),
  wind_speed_kph:firstNumber(sources,['wind_speed_kph','windSpeedKph'],false),
  wind_chill_c:firstFiniteNumber(sources,['wind_chill_c','windChillC']),
  wind_chill_f:firstFiniteNumber(sources,['wind_chill_f','windChillF']),
  precipitation:enumValue(sources,['precipitation'],{none:'none',rain:'rain',snow:'snow',sleet:'sleet',mixed:'mixed'}),
  wetness:enumValue(sources,['wetness'],{dry:'dry',wet:'wet'}),
  footing:enumValue(sources,['footing'],{clear:'clear',normal:'clear',slippery:'slippery',slick:'slippery'}),
  ice_risk:iceRisk===true?'present':iceRisk===false?'absent':'unknown',
  daylight:enumValue(sources,['daylight','light_condition','lightCondition'],{day:'daylight',daylight:'daylight',dark:'darkness',darkness:'darkness',night:'darkness'}),
  heat_exposure:heatExposure===true?'present':heatExposure===false?'absent':'unknown',
  source:'app_context',
 };
}
function adaptationDecision(message:string,signals:readonly CoachEnvironmentSignal[],environment:StructuredEnvironmentContext|null):EnvironmentAdaptationDecision|null{
 if(!signals.length&&!environment)return null;
 const reasons:string[]=[];
 let action:EnvironmentAdaptationAction='insufficient_context';
 const m=normalize(message);
 const iceConcern=environment?.ice_risk==='present'||environment?.footing==='slippery';
 const compoundColdWetWind=signals.includes('cold')&&signals.includes('wet')&&signals.includes('wind');
 const indoorRequested=/\b(move|switch|go|train|run|ride)\b.{0,32}\b(inside|indoors|treadmill|indoor trainer)\b/.test(m)||/\b(inside|indoors|treadmill|indoor trainer)\b.{0,32}\b(instead|replacement|substitute)\b/.test(m);
 if(iceConcern){
  action='flag_safety_concern';
  reasons.push(environment?.ice_risk==='present'?'known_ice_risk':'known_slippery_footing');
 }else if(compoundColdWetWind||indoorRequested){
  action='suggest_indoor_substitution';
  reasons.push(compoundColdWetWind?'combined_cold_wet_wind_exposure':'explicit_indoor_substitution_request');
 }else if(signals.some(signal=>['heat_humidity','wet','wind','snow_ice','low_light'].includes(signal))||environment?.heat_exposure==='present'||environment?.wetness==='wet'||environment?.daylight==='darkness'){
  action='modify_execution';
  if(signals.includes('heat_humidity')||environment?.heat_exposure==='present')reasons.push('heat_or_humidity_execution_cost');
  if(signals.includes('wet')||environment?.wetness==='wet')reasons.push('wetness_execution_effect');
  if(signals.includes('wind'))reasons.push('wind_execution_effect');
  if(signals.includes('snow_ice'))reasons.push('snow_or_ice_report_without_confirmed_footing_risk');
  if(signals.includes('low_light')||environment?.daylight==='darkness')reasons.push('low_light_execution_constraint');
 }else if(environment){
  const numericExposureKnown=[environment.temperature_c,environment.temperature_f,environment.humidity_percent,environment.wind_speed_mph,environment.wind_speed_kph,environment.wind_chill_c,environment.wind_chill_f].some(value=>value!==null);
  const neutralCategorical=environment.precipitation==='none'&&environment.wetness==='dry'&&environment.footing==='clear'&&environment.ice_risk==='absent'&&environment.daylight==='daylight'&&environment.heat_exposure==='absent';
  if(neutralCategorical&&!numericExposureKnown){
   action='preserve_planned_session';
   reasons.push('known_neutral_execution_conditions');
  }else{
   reasons.push(numericExposureKnown?'numeric_environment_requires_athlete_and_exposure_context':'environment_context_incomplete');
  }
 }else{
  reasons.push('qualitative_environment_context_incomplete');
 }
 return{action,reasons,automatic_training_rewrite:false,change_of_plans_owner:'existing_training_change_of_plans',plan_mutation_policy:'existing_preview_confirm_apply_only'};
}

function roadRunRules(event:RoadRunEvent):string[]{
 const common=[
  'Road-running progression must be constrained by canonical athlete history, current running capability, weekly availability and current recovery. Missing inputs remain unknown; do not invent mileage, pace, workout density or readiness from absent evidence.',
  'Do not infer race readiness from a completed distance or one long run alone; readiness requires event-specific preparation, recent consistency, recovery and supported current capability.',
  'Do not use a fixed 10-percent weekly growth rule, a fixed long-run share of weekly mileage, or arbitrary cross-training mileage equivalence as universal deterministic truth.',
  'Long-run progression may advance only when recent long-run execution and recovery support it; after disrupted training, poor recovery or an unsuccessful long run, hold or reduce before increasing again.',
  'Keep easy and recovery running meaningfully easy around quality work; do not add or stack quality merely because calendar availability exists.',
  'Taper progression should reduce overall training load while retaining familiar running frequency and some event-relevant intensity where appropriate; exact taper duration and reduction remain event- and athlete-specific Coach judgment.',
 ];
 switch(event){
  case'beginner_return':return[...common,
   'Beginner or return-to-running progression should first establish repeatable easy running exposure and tolerance; run/walk is an option when continuous running capability is not established.',
   'Delay formal sustained quality progression until the athlete demonstrates that ordinary easy running frequency and duration are tolerated with acceptable recovery; prior peak fitness must not be treated as current capability after a layoff.',
  ];
  case'5k':return[...common,
   'For 5K preparation, establish easy aerobic consistency first, then progress neuromuscular speed/strides and controlled threshold work before demanding event-specific interval density; exact paces and repetitions require known capability.',
   'As the event approaches, 5K-specific work may become more race-demand specific while easy/recovery running continues to protect adaptation between quality sessions.',
  ];
  case'10k':return[...common,
   'For 10K preparation, build aerobic durability and threshold tolerance before increasing race-specific interval density; faster work supplements rather than replaces easy volume and recovery.',
   'Progress sustained controlled work toward event-specific 10K demands only when current capability and recovery support it; do not derive target pace from race distance alone.',
  ];
  case'half_marathon':return[...common,
   'For half-marathon preparation, progress aerobic volume, long-run durability and controlled threshold/tempo work before adding larger event-pace segments; event-pace volume must be constrained by current capability and recovery.',
   'The long run is important but is not a standalone readiness test; supporting weekly consistency and recovery remain part of the progression decision.',
  ];
  case'marathon':return[...common,
   'For marathon preparation, progress durable easy volume and long runs first, then add event-specific steady or marathon-pace work when the athlete has demonstrated tolerance; do not force marathon-pace volume from goal time alone.',
   'Marathon long runs should also support practiced fueling/hydration execution when relevant, while exact distance, duration and frequency remain constrained by athlete history, availability and recovery rather than a universal formula.',
  ];
  case'road_ultra':return[...common,
   'For a known road ultra, progress durable time-on-feet, long-run execution and fueling/hydration practice from demonstrated capability; back-to-back long runs are optional and require history/recovery support rather than being mandatory.',
   'Road-ultra preparation may extend long-duration specificity, but one completed long distance does not establish race readiness and no fixed conversion from marathon training or weekly mileage should be invented.',
  ];
  default:return common;
 }
}

function sportRules(sport:CoachTrainingSport|null,roadEvent:RoadRunEvent|null):string[]{
 switch(sport){
  case'trail_mountain':return[
   'Trail/mountain execution should use effort, vertical gain/loss, grade and technicality rather than treating road pace as the primary load signal.',
   'Uphill and downhill are distinct demands; downhill progression adds eccentric/durability stress and should not be increased aggressively from missing capability evidence.',
   'Power-hiking, terrain-specific long runs and equipment practice should be driven by known race/course demands, not added to every trail plan by default.',
  ];
  case'cycling':return[
   'Cycling progression must be constrained by canonical athlete history, current cycling capability, weekly availability and current recovery. Missing inputs remain unknown; do not invent volume, intensity, workout density or readiness from absent evidence.',
   'Cycling progression should distinguish aerobic/endurance, long-ride, tempo/sweet-spot/threshold, VO2 and race-specific demands rather than translating running workouts by label.',
   'Aerobic/endurance progression may advance duration or frequency only when recent endurance riding and recovery support it; do not apply a fixed weekly percentage increase or infer readiness from ride duration alone.',
   'Long-ride progression may advance only when recent long-ride execution, broader weekly consistency and recovery support it; one completed long ride is not a standalone readiness test.',
   'Tempo, sweet-spot and threshold work should progress from demonstrated aerobic tolerance and current capability. Increase sustained work, repetitions or density only when prior sessions are repeatable with acceptable recovery; exact intensity and watt targets remain capability-dependent Coach judgment.',
   'VO2 work is not mandatory for every cyclist or every phase. Add or progress it only when the athlete goal, current capability, recent tolerance and recovery support it, while keeping surrounding endurance/recovery riding meaningfully easier.',
   'Protect recovery balance around cycling quality: do not stack threshold/VO2 sessions or add intensity merely because calendar availability exists; after poor recovery, disrupted training or unsuccessful quality execution, hold or reduce before increasing again.',
   'Indoor and outdoor cycling may share a physiological objective, but indoor execution should account for controlled resistance and cooling while outdoor execution may require terrain, handling and pacing variability; do not assume they are mechanically interchangeable.',
   'Use FTP or power targets only when canonical trusted cycling capability supplies a current validated_test, validated_estimate or training_state snapshot. Client-editable/manual FTP or missing/stale capability must remain unknown and must not be promoted into invented watt targets.',
  ];
  case'swimming':return[
   'Swimming progression must be constrained by canonical athlete history, current swim capability, weekly availability and current recovery. Missing inputs remain unknown; do not invent volume, pace, intensity, workout density or readiness from absent evidence.',
   'Swimming progression should distinguish technique, aerobic endurance, threshold/CSS-style work and pool/open-water specificity when supported by the athlete, goal and session context rather than translating running or cycling workouts by label.',
   'Technique remains a progression constraint, not just a warm-up category: when stroke quality or repeatability degrades, hold or reduce volume/intensity before adding harder or longer work; exact drill selection remains Coach judgment unless a known technique need supports it.',
   'Aerobic endurance may progress through repeatable session duration, total supported swim volume or frequency only when recent swimming consistency, technique quality and recovery support it; do not apply a fixed weekly percentage increase or infer readiness from distance alone.',
   'Session-volume progression must reflect the athlete\'s recent swim history and the composition of the session. A completed distance by itself does not justify increasing total volume, continuous-swim length or interval density.',
   'Threshold or CSS-style work may progress by sustained work duration, repetitions or density only after repeatable aerobic and prior threshold execution with acceptable technique and recovery; exact pace targets remain capability-dependent Coach judgment.',
   'Use CSS/threshold pace only from a trustworthy current swimming capability source or supported test result. Client-editable/manual pace, a goal time, or missing/stale capability must remain unknown and must not be promoted into invented CSS or threshold targets.',
   'Protect recovery balance around swim quality: do not stack demanding threshold sessions or increase intensity merely because pool time is available; after poor recovery, disrupted swimming or degraded technique, hold or reduce before increasing again.',
   'Pool and open-water sessions may share an aerobic or threshold objective, but pool execution may use controlled lengths, rests and repeatability while open water may require sighting, navigation, continuous pacing and environment-specific skills; do not assume the settings are mechanically interchangeable.',
   'Do not convert swim volume into fake running-equivalent miles, and do not treat a single long or fast swim as standalone readiness evidence.',
  ];
  case'strength':return[
   'Strength progression must be constrained by canonical athlete history, current strength capability, weekly availability and current recovery. Missing inputs remain unknown; do not invent volume, frequency, exercise readiness, 1RM values or load targets from absent evidence.',
   'Strength progression should follow the stated goal: general strength, hypertrophy and sport-support strength are distinct goals with different useful progression choices; do not force one universal loading model across them.',
   'Progression evidence should come from canonical completed Strength history and stable exercise identity. Reuse canonical set data such as completed reps, load, RPE/RIR and set completion when trustworthy; transient client fields, labels or unsupported manual claims are not completed-session evidence.',
   'For the same stably identified exercise, successful prior sets may support repeating the prior prescription or cautiously progressing one supported variable, but there is no forced linear load increase. Do not automatically increase load simply because a session was completed.',
   'Do not invent a 1RM, estimated 1RM or target load. When trustworthy current capability or canonical completed-set history does not support a load decision, the load must remain unknown rather than being converted into a prescribed load; exact load selection remains Coach judgment.',
   'General-strength progression may increase supported repetitions, sets, exercise difficulty or load only after repeatable successful execution with acceptable technique/effort evidence and recovery. Change one meaningful stressor at a time when deterministic evidence is limited rather than escalating every variable together.',
   'Hypertrophy progression may add supported volume through repetitions, sets or exercise distribution when recent work is repeatable and recovery supports it; do not require a universal sets-per-muscle target, forced load increase or fixed weekly volume increase as deterministic truth.',
   'Sport-support strength for endurance athletes should preserve the primary endurance adaptation: favor the minimum useful Strength dose and movement demands that support the athlete goal, and do not add bodybuilding-style volume by default when it would compromise key endurance work.',
   'For concurrent athletes, manage lower-body fatigue around key endurance sessions and races. Avoid placing or escalating high-fatigue lower-body Strength immediately before key endurance quality or long sessions when the known schedule and recovery do not support it; exact sequencing remains Coach judgment.',
   'Do not increase Strength session frequency merely because calendar space exists. Frequency progression requires demonstrated tolerance, athlete availability and recovery, and missed sessions should not be backfilled by stacking extra Strength work into an already demanding week.',
   'A missed, incomplete or poorly recovered Strength session is not evidence to escalate. Hold, repeat or reduce before progressing when recent completion, effort, soreness/fatigue or concurrent endurance load shows inadequate recovery or uncertain tolerance.',
  ];
  case'multisport':return[
   'Multisport progression must be constrained by canonical athlete history, weekly availability, current recovery and separately known capability in each discipline. Unknown capability in any discipline remains unknown; do not infer one sport from another or invent pace, power, volume, frequency or readiness to make the plan complete.',
   'Build one integrated multisport week rather than stacking independent sport plans. Balance discipline-specific frequency, duration and quality against the athlete\'s total recoverable load and available days, while preserving the purpose of each supported discipline.',
   'Triathlon programming must reuse the existing swimming, cycling and running progression principles inside one shared plan: progress each discipline only from trustworthy discipline-specific history/capability, then constrain the combined week by total recovery rather than summing three independent plans.',
   'Do not double-count or duplicate load: when sessions stress the same aerobic, muscular or neuromuscular systems, account for their combined cost before adding progression. A hard session in one discipline can constrain another discipline even when the sport labels differ.',
   'Preserve sport-specific key sessions as distinct work when they serve different adaptations. Do not convert every discipline into generic endurance, and do not replace needed standalone technique, quality or long-session work merely to create a balanced-looking week.',
   'Triathlon weekly balance should reflect the known race format and the athlete\'s relative capability, history, availability and recovery; do not enforce a universal swim/bike/run percentage or equal progression across all three disciplines.',
   'Longer-distance triathlon should shift specificity toward durable cycling, controlled running off the bike, race-execution practice and recovery management rather than automatically scaling swim, bike and run volume upward together.',
   'Protect recovery between disciplines: avoid stacking demanding sessions that target overlapping systems back-to-back when known recovery, history or availability does not support it. After poor recovery, disrupted training, missed sessions or unsuccessful execution, hold, repeat or reduce before adding cross-discipline load.',
   'Brick and transition sessions require a known race or training purpose. Introduce them only when the athlete has sufficient standalone capability in the component disciplines and current recovery supports combining them; a goal label alone does not establish transition readiness.',
   'Brick progression should be conservative: first establish repeatable bike-to-run transition exposure, then progress only one supported variable such as component duration, transition specificity or race-relevant intensity when prior bricks and surrounding recovery are tolerated. Do not simultaneously escalate both component loads and intensity.',
   'A brick is one integrated stress exposure, not two independent workouts for weekly-load accounting. Still preserve the component disciplines in analysis so fatigue or capability in one sport is not hidden by the combined session.',
   'Transition practice can be low-load skill work as well as part of a brick. Practice T1/T2 procedures when they are relevant to the race, but do not require hard combined sessions merely to rehearse transitions.',
   'Open-water preparation is warranted when the known target race or athlete context includes open water. Progress environment-specific skills such as sighting, navigation, starts, buoy turns and continuous pacing from safe, supported exposure; do not assume open-water access, wetsuit use or race conditions when they are unknown.',
   'Race-specific rehearsal should progressively combine only the known demands that matter for the target event, such as pacing, transitions, equipment execution, open-water skills and fueling/hydration. Do not require a full-distance race simulation or treat one rehearsal as proof of readiness.',
   'Coordinate long-ride and long-run progression instead of maximizing both in the same week. When one key endurance session becomes materially more demanding, hold or reduce the other when recovery/history does not support simultaneous progression.',
   'For known Sprint triathlon preparation, emphasize reliable swim/bike/run execution, transition skill and race-intensity specificity without importing long-course fueling volume or long-session demands that the athlete has not demonstrated a need for.',
   'For known Olympic-distance triathlon preparation, preserve balanced three-discipline development while adding race-specific bike-to-run and transition work; do not simply extend Sprint sessions or force long-course duration.',
   'For known 70.3 or half-distance preparation, progressively prioritize long-ride durability, controlled running after cycling, race-specific rehearsal and practiced fueling/hydration while protecting the long run from simultaneous aggressive escalation.',
   'For known Ironman or full-distance preparation, prioritize sustainable all-day durability, long-ride execution, conservative bike-to-run specificity, fueling/hydration practice and recovery between key sessions; do not require race-distance training sessions or scale every discipline upward together.',
   'Taper should reduce accumulated triathlon load while preserving enough familiar frequency and event-relevant intensity to maintain readiness. Longer-course athletes may need more recovery from accumulated duration, but exact taper length, discipline-by-discipline reductions and percentages remain athlete- and event-specific Coach judgment rather than fixed formulas.',
   'For long-course triathlon, fueling and hydration must be practiced during appropriately long bike, brick or rehearsal sessions before race day. Exact carbohydrate, fluid, sodium or caffeine targets require the athlete\'s established Nutrition/Fuel context and tolerance; do not invent them from race distance alone.',
   'Do not use arbitrary cross-sport mileage, time or load equivalence to fill gaps. Comparable stress may inform Coach judgment, but deterministic progression must use trustworthy discipline-specific history plus the known combined weekly context.',
   'Exact discipline weighting, key-session selection, rehearsal design and transition specificity remain Coach judgment when event demands, athlete priorities or capability evidence are incomplete; deterministic rules should constrain unsafe or unsupported progression rather than fabricate a complete periodization model.',
  ];
  case'hike_ruck':return[
   'Hike/ruck progression must be constrained by canonical hike/ruck history, current capability, weekly availability and current recovery. Missing duration, distance, vertical, terrain and carried-load capability remain unknown; do not invent them from labels, generic walking history or goal demands.',
   'Hike/ruck is not generic walking: duration/time-on-feet, actual distance, elevation gain/loss, terrain difficulty and carried load are distinct stressors and should be progressed from the athlete\'s demonstrated tolerance rather than collapsed into one walking-equivalent metric.',
   'Duration progression may advance time-on-feet only when recent hike/ruck completion and recovery support it. Do not apply a fixed weekly percentage increase, and do not treat one long outing or available calendar time as sufficient evidence to progress.',
   'Distance progression is justified only when trustworthy completed hike/ruck distance exists and the terrain, elevation and load context are known enough to compare. A longer duration alone does not establish readiness for a longer distance, and no running-equivalent pace or distance conversion should be invented.',
   'Elevation/climbing progression should build from demonstrated vertical tolerance and known terrain demands. Increase climbing or descending exposure cautiously when prior sessions and recovery support it; steep or technical terrain may materially increase load even when distance is unchanged.',
   'Ruck/load progression requires a known supported carried load from canonical completed history or exact structured Training context. Do not invent a pack weight, starting load or load percentage, and do not increase carried load merely because an unweighted hike was completed; exact load selection remains Coach judgment when capability is incomplete.',
   'Do not aggressively increase distance or duration, elevation and carried load at the same time. When deterministic evidence is limited, progress one primary stressor while holding the others stable enough to evaluate tolerance before stacking additional progression.',
   'Terrain specificity should reflect known goal or route demands when available, including surface, grade and technicality, but unknown terrain remains unknown. Do not prescribe technical, steep or loaded specificity solely from a hike/ruck label.',
   'Protect recovery balance around demanding hike/ruck sessions: after poor recovery, excessive soreness/fatigue, disrupted training, missed sessions or unsuccessful execution, hold, repeat or reduce before progressing. Do not backfill missed work by stacking extra long, steep or loaded sessions into the same week.',
   'Unloaded hiking and loaded rucking can share aerobic and terrain demands but are not interchangeable capability evidence. Progression should preserve the known mode and carried-load context unless Coach judgment deliberately changes the goal.',
  ];
  case'elliptical_stairs':return[
   'Elliptical/stair progression must be constrained by canonical machine-specific history, athlete weekly availability, current recovery and currently demonstrated capability. Missing machine duration, intensity, vertical or tolerance remains unknown; do not infer it from running, cycling or a generic fitness label.',
   'Use elliptical or stair-climber work only for a known Training purpose such as aerobic endurance, recovery-compatible aerobic work or muscular endurance. The modality label alone does not establish the intended adaptation or justify progression.',
   'Aerobic duration may progress only when recent machine-specific sessions of comparable purpose were completed repeatably with acceptable recovery. Do not apply a fixed weekly percentage increase, and do not increase duration merely because more calendar time is available.',
   'Intensity may progress only when the intended workout purpose, trustworthy prior machine-specific execution and current recovery support it. Increase one supported variable such as sustained work, repetitions or work-to-recovery density rather than escalating duration and intensity together when evidence is limited; exact intensity remains Coach judgment unless trustworthy capability exists.',
   'Do not invent machine pace, power, resistance, level, cadence, floors, vertical rate or other capability targets. A machine display value is usable for progression only when it comes from trustworthy structured history for that athlete and comparable machine context.',
   'For stair-climber work, progress time first when only duration tolerance is known. Progress vertical/ascent only when trustworthy completed stair-specific vertical data exists; otherwise vertical capability remains unknown and floors, levels or elapsed time must not be converted into invented ascent.',
   'Protect recovery balance around harder or longer machine sessions. After poor recovery, excessive lower-body fatigue/soreness, disrupted training, missed sessions or unsuccessful execution, hold, repeat or reduce before progressing, and do not backfill missed machine work into an already demanding week.',
   'When elliptical or stair work is used alongside running or cycling, account for its aerobic and muscular cost in the total week so it does not silently stack load on top of key sessions. Availability alone is not evidence that more cross-training is recoverable.',
   'Cross-training substitutions should preserve the original workout purpose where the modality can reasonably support it, such as replacing some aerobic time, but they are not identical to running or cycling. Do not claim that elliptical or stair work preserves running impact/economy, cycling power/handling, race-specific skill or any fixed mileage/load equivalence.',
   'Exact machine choice, session structure and cross-training substitution remain Coach judgment when purpose, machine-specific history or capability evidence is incomplete; deterministic rules should constrain unsupported progression rather than fabricate a complete machine prescription.',
  ];
  case'yoga_mobility':return[
   'Yoga/mobility should remain simple unless the user has an explicit structured goal; do not manufacture periodization or recovery claims from attendance alone.',
  ];
  case'road_run':return roadRunRules(roadEvent??'unknown');
  default:return[];
 }
}

function environmentRules(signals:readonly CoachEnvironmentSignal[]):string[]{
 const rules:string[]=[];
 if(signals.includes('heat_humidity'))rules.push('Heat/humidity can raise physiological cost at the same pace/power; preserve the intended effort before interpreting slower output as lost fitness.','Heat acclimation requires repeated controlled exposure; one hot session is not full acclimation.');
 if(signals.includes('cold'))rules.push('Cold risk depends on temperature together with wind, wetness, exposure duration, clothing, fatigue and available shelter; do not use one universal temperature cutoff as truth.');
 if(signals.includes('wet'))rules.push('Wet conditions can increase cold stress, visibility and traction problems; rainfall alone does not automatically require canceling an outdoor session.');
 if(signals.includes('wind'))rules.push('Wind changes pace/power cost and handling; use effort and route exposure rather than treating a slower pace as a fitness signal.');
 if(signals.includes('snow_ice'))rules.push('Footing and fall risk outrank pace targets on snow or ice; modify execution or use the existing indoor/change-of-plans path when safe outdoor execution is not supported.');
 if(signals.includes('low_light'))rules.push('Low-light execution should account for visibility and route familiarity; do not infer daylight or lighting conditions that were not supplied.');
 if(signals.length)rules.push('Environment may preserve the planned session, modify execution, suggest an indoor substitute, or flag a safety concern; any schedule/plan mutation must use the existing Training Change-of-Plans owner.');
 return rules;
}

function environmentGuidance(signals:readonly CoachEnvironmentSignal[],environment:StructuredEnvironmentContext|null):string[]{
 const guidance:string[]=[];
 const heat=signals.includes('heat_humidity')||environment?.heat_exposure==='present';
 const cold=signals.includes('cold');
 const wet=signals.includes('wet')||environment?.wetness==='wet'||['rain','sleet','mixed'].includes(environment?.precipitation??'unknown');
 const wind=signals.includes('wind');
 const lowLight=signals.includes('low_light')||environment?.daylight==='darkness';
 const ice=signals.includes('snow_ice')||environment?.ice_risk==='present'||environment?.footing==='slippery';
 if(cold||wet)guidance.push('For known cold or wet exposure, favor adaptable layers that can keep insulation dry and reduce exposed-skin exposure as conditions warrant; keep the advice conditional on duration, wind, shelter and the athlete rather than prescribing a universal outfit.');
 if(wet)guidance.push('For known rain or wetness, consider water-resistant protection, dry post-session layers and traction/visibility implications only as options if appropriate and available; do not assume the athlete owns specific gear.');
 if(heat)guidance.push('For known heat or humidity exposure, keep fluids and planned fuel accessible, pace by intended effort, and use the athlete\'s established hydration/electrolyte/fueling strategy; do not invent fluid, sodium or carbohydrate amounts from weather alone.');
 if(cold||wind)guidance.push('For known cold or wind exposure, account for wind-facing sections, exposed skin, wet clothing and access to shelter or a shorter route; escalate conservatively if safe exposure cannot be supported.');
 if(lowLight)guidance.push('For known darkness or low light, prioritize both seeing the route and being visible to others using available lighting or reflective options; do not assume specific equipment is owned.');
 if(ice)guidance.push('For known ice, slippery footing or snow/ice risk, prioritize stable footing and fall-risk reduction over pace; route changes or the existing indoor Change-of-Plans path are preferable when safe footing is not supported, without inventing traction equipment.');
 return [...new Set(guidance)];
}

export function buildSportTrainingContext(message:string,route:Route,appContext:unknown):SportTrainingContext|null{
 if(!relevant(message,route))return null;
 const requestSport=explicitSport(message),attachedSport=contextSport(appContext),sport=requestSport??attachedSport,roadEvent=sport==='road_run'?roadRunEvent(message,appContext):null,signals=environmentSignals(message),environment=structuredEnvironmentContext(appContext),decision=adaptationDecision(message,signals,environment),guidance=environmentGuidance(signals,environment),rules=[...sportRules(sport,roadEvent),...environmentRules(signals)];
 if(!rules.length&&!decision)return null;
 const facts=!requestSport||requestSport===attachedSport?sessionFacts(appContext):null;
 return{
  version:'sport_training_context_v1',sport,sport_source:requestSport?'user_request':attachedSport?'app_context':null,road_run_event:roadEvent,session_facts:facts,environment_signals:signals,environment_context:environment,environment_decision:decision,environment_guidance:guidance,rules:[...new Set(rules)],
  guardrails:[
   'Session facts contain only exact structured values from the attached Training object. Missing fields remain unknown; do not infer elevation, load, terrain or duration from labels or formatted copy.',
   'Environment facts contain only exact structured values from attached context. Missing temperature, humidity, wind, wind chill, precipitation, wetness, footing, ice risk, daylight and heat-exposure fields remain unknown; do not infer or unit-convert them.',
   'Unknown athlete capability, training history, weekly availability, recovery state, terrain, race demands, weather values and environmental exposure remain unknown; do not invent them.',
   'Do not infer race readiness from distance alone or create equivalent miles, universal progression percentages, universal pace corrections or universal environmental cutoffs as certain truth.',
   'Environment decisions extend the existing Training Change-of-Plans behavior; they never create a parallel weather plan and never automatically rewrite Training.',
   'Any Training mutation remains behind the existing preview/confirm/apply flow.',
   'Environmental clothing, visibility, traction, hydration and fueling guidance is conditional on known conditions; never infer gear ownership, athlete tolerance or exact intake needs that were not supplied.',
   'Pain, illness or dangerous environmental symptoms remain under existing health/safety escalation boundaries.',
  ],
 };
}