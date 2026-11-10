/**
 * V2 deterministic multi-sport Training plan constraint layer.
 * Coach proposes evidence-backed session intents; this module schedules and
 * audits them. It does not invent paces, watts, distances, loads or dose.
 */
export type TrainingSport='running'|'cycling'|'swimming'|'strength'|'hiking'|'rucking'|'rowing'|'elliptical'|'stair'|'yoga'|'mobility'|'other';
export type TrainingPriority='competition'|'key'|'supporting'|'optional';
export type TrainingIntensity='easy'|'moderate'|'hard'|'unknown';
export type TrainingDay='monday'|'tuesday'|'wednesday'|'thursday'|'friday'|'saturday'|'sunday';
export type StrengthExerciseRole='major'|'abdominal'|'accessory';
export type StrengthWorkoutStructure={format:'supersets'|'straight_sets';blocks:Array<{id:string;rounds:number;movements:Array<{exerciseId:string;role:StrengthExerciseRole;sets:number;reps:string}>}>};
export type StrengthStructureRule={id:string;day?:TrainingDay;format:'supersets'|'straight_sets';blockCount:number;roundsPerBlock:number;requiredRoles?:StrengthExerciseRole[];movementsPerBlock?:number};
export type TrainingSessionIntent={
 id:string;sport:TrainingSport;label:string;purpose:string;priority:TrainingPriority;intensity:TrainingIntensity;
 durationMinutes:number|null;preferredDays?:TrainingDay[];fixedDay?:TrainingDay;strengthWorkout?:StrengthWorkoutStructure;
 demand:{aerobic:'low'|'moderate'|'high'|'unknown';mechanicalImpact:'low'|'moderate'|'high'|'not_applicable'|'unknown';localMuscular:'low'|'moderate'|'high'|'unknown';technicalSkill:'low'|'moderate'|'high'|'not_applicable'|'unknown'};
 stressTags:string[];evidenceRefs:string[];
};
export type TrainingAthletePlanContext={
 primaryGoal:{id:string;label:string;sports:TrainingSport[]};
 secondaryGoals:Array<{id:string;label:string;sports:TrainingSport[]}>;
 availableDays:TrainingDay[];unavailableDays?:TrainingDay[];activeRestrictions:string[];requiredSports:TrainingSport[];
 maxSessionsPerDay?:number;existingAcceptedSessionIds?:string[];strengthStructureRules?:StrengthStructureRule[];
};
export type TrainingPlanIssue={
 code:'DUPLICATE_SESSION_ID'|'SPORT_NOT_IN_GOALS'|'SPORT_RESTRICTION'|'FIXED_DAY_UNAVAILABLE'|'UNSCHEDULED_KEY_SESSION'|'REQUIRED_SPORT_MISSING'|'MULTIPLE_HARD_SESSIONS_SAME_DAY'|'ADJACENT_HIGH_DEMAND_DAYS'|'UNSUPPORTED_PRESCRIPTION'|'STRENGTH_STRUCTURE_INVALID'|'EXERCISE_RESTRICTED'|'MISSING_EVIDENCE';
 severity:'blocking'|'review';sessionIds:string[];days:TrainingDay[];message:string;
};
export type TrainingPlanDraft={
 version:1;goalId:string;primaryGoal:string;days:Array<{day:TrainingDay;sessions:TrainingSessionIntent[]}>;
 unscheduled:Array<{session:TrainingSessionIntent;reason:string}>;issues:TrainingPlanIssue[];
 status:'review_required'|'blocked';rationale:string[];
 invariants:{sportsKeptSeparate:true;noAutomaticPlanWrite:true;noInventedPrescription:true};
};
const DAYS:TrainingDay[]=['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
const PRIORITY:Record<TrainingPriority,number>={optional:0,supporting:1,key:2,competition:3};
function validSession(s:TrainingSessionIntent):boolean{
 const demand=s?.demand;
 const validLevels=['low','moderate','high','unknown'];
 return Boolean(s&&typeof s.id==='string'&&s.id.trim()&&typeof s.label==='string'&&s.label.trim()&&typeof s.purpose==='string'&&s.purpose.trim()&&
 ['running','cycling','swimming','strength','hiking','rucking','rowing','elliptical','stair','yoga','mobility','other'].includes(s.sport)&&
 ['competition','key','supporting','optional'].includes(s.priority)&&['easy','moderate','hard','unknown'].includes(s.intensity)&&
 (s.durationMinutes===null||(Number.isFinite(s.durationMinutes)&&s.durationMinutes>0&&s.durationMinutes<=900))&&
 demand&&validLevels.includes(demand.aerobic)&&validLevels.includes(demand.localMuscular)&&
 ['low','moderate','high','not_applicable','unknown'].includes(demand.mechanicalImpact)&&
 ['low','moderate','high','not_applicable','unknown'].includes(demand.technicalSkill)&&
 Array.isArray(s.stressTags)&&s.stressTags.every(x=>typeof x==='string')&&
 Array.isArray(s.evidenceRefs)&&s.evidenceRefs.every(x=>typeof x==='string')&&
 (s.strengthWorkout===undefined||(s.strengthWorkout&&Array.isArray(s.strengthWorkout.blocks)&&s.strengthWorkout.blocks.every(b=>b&&typeof b==='object'&&Array.isArray(b.movements)&&b.movements.every(m=>m&&typeof m==='object')))));
}
function strengthStructureIssue(s:TrainingSessionIntent,context:TrainingAthletePlanContext):string|null{
 const allRules=(context.strengthStructureRules??[]);
 if(s.sport!=='strength')return s.strengthWorkout?'Strength prescription attached to a non-strength session.':null;
 if(allRules.some(rule=>rule.day)&&!s.fixedDay&&!(s.preferredDays?.length))return 'A strength session must bind to its planned day so the correct athlete-approved structure can be enforced.';
 const rules=allRules.filter(rule=>!rule.day||rule.day===s.fixedDay||(s.preferredDays??[]).includes(rule.day));
 if(s.strengthWorkout){
  if(!['supersets','straight_sets'].includes(s.strengthWorkout.format)||!Array.isArray(s.strengthWorkout.blocks)||s.strengthWorkout.blocks.length===0)return 'Strength workout structure is invalid.';
  for(const block of s.strengthWorkout.blocks){
   if(typeof block.id!=='string'||!block.id.trim()||!Number.isInteger(block.rounds)||block.rounds<1||block.rounds>10||!Array.isArray(block.movements)||block.movements.length===0)return 'Strength block identity, rounds or movement list is invalid.';
   for(const movement of block.movements)if(typeof movement.exerciseId!=='string'||!movement.exerciseId.trim()||!['major','abdominal','accessory'].includes(movement.role)||!Number.isInteger(movement.sets)||movement.sets<1||movement.sets>20||typeof movement.reps!=='string'||!movement.reps.trim())return 'Strength movement prescription is invalid.';
  }
 }
 for(const rule of rules){
  const structure=s.strengthWorkout;
  if(!structure||structure.format!==rule.format||structure.blocks.length!==rule.blockCount||
     structure.blocks.some(block=>block.rounds!==rule.roundsPerBlock))return 'The proposed strength structure conflicts with an active athlete-approved structure rule.';
  for(const block of structure.blocks){
   if(rule.movementsPerBlock!==undefined&&block.movements.length!==rule.movementsPerBlock)return 'A strength block has the wrong number of paired movements.';
   if(rule.requiredRoles?.length){
    const actual=block.movements.map(m=>m.role).sort().join('|');
    if(actual!==[...rule.requiredRoles].sort().join('|'))return 'A strength pairing does not match the required movement roles.';
   }
  }
 }
 return null;
}
function hardDemand(s:TrainingSessionIntent):boolean{return s.intensity==='hard'||s.demand.aerobic==='high'||s.demand.localMuscular==='high'||s.demand.mechanicalImpact==='high'}
function overlap(a:TrainingSessionIntent,b:TrainingSessionIntent):boolean{const tags=new Set(a.stressTags.map(x=>x.trim().toLowerCase()).filter(Boolean));return b.stressTags.some(x=>tags.has(x.trim().toLowerCase()))}
const idx=(day:TrainingDay)=>DAYS.indexOf(day);
function allowedSport(sport:TrainingSport,c:TrainingAthletePlanContext):boolean{return c.primaryGoal.sports.includes(sport)||c.secondaryGoals.some(g=>g.sports.includes(sport))||c.requiredSports.includes(sport)}
function makeIssue(code:TrainingPlanIssue['code'],severity:TrainingPlanIssue['severity'],message:string,sessionIds:string[]=[],days:TrainingDay[]=[]):TrainingPlanIssue{return{code,severity,message,sessionIds,days}}

export function synthesizeTrainingWeek(context:TrainingAthletePlanContext,proposed:TrainingSessionIntent[]):TrainingPlanDraft{
 if(!context?.primaryGoal?.id||!context.primaryGoal.label||!Array.isArray(context.availableDays)||!Array.isArray(proposed))throw new Error('Primary goal, availability and proposed session intents are required.');
 const available=DAYS.filter(day=>context.availableDays.includes(day)&&!(context.unavailableDays??[]).includes(day));
 if(!available.length)throw new Error('No available training days were confirmed.');
 const days=DAYS.map(day=>({day,sessions:[] as TrainingSessionIntent[]}));
 const unscheduled:TrainingPlanDraft['unscheduled']=[];
 const issues:TrainingPlanIssue[]=[];
 const ids=new Set<string>(),accepted=new Set(context.existingAcceptedSessionIds??[]);
 const maxPerDay=Math.max(1,Math.min(3,Math.floor(context.maxSessionsPerDay??2)));
 const priorityValue=(s:unknown)=>PRIORITY[(s as TrainingSessionIntent|null)?.priority]??-1;
 const safeHard=(s:unknown)=>{const v=s as TrainingSessionIntent|null;return Boolean(v&&(v.intensity==='hard'||v.demand?.aerobic==='high'||v.demand?.localMuscular==='high'||v.demand?.mechanicalImpact==='high'))};
 const ordered=[...proposed].sort((a,b)=>priorityValue(b)-priorityValue(a)||Number(safeHard(b))-Number(safeHard(a)));
 for(const s of ordered){
  if(!validSession(s)){issues.push(makeIssue('UNSUPPORTED_PRESCRIPTION','blocking','A proposed session is missing valid identity, purpose, intensity, demand or quantity fields.'));continue}
  if(ids.has(s.id)||accepted.has(s.id)){issues.push(makeIssue('DUPLICATE_SESSION_ID','blocking','A session identity is duplicated or already accepted.',[s.id]));continue}
  ids.add(s.id);
  if(!allowedSport(s.sport,context)){issues.push(makeIssue('SPORT_NOT_IN_GOALS','review','This modality is not linked to a goal or declared required sport.',[s.id]));unscheduled.push({session:s,reason:'Sport-goal relationship needs athlete review.'});continue}
  const structureError=strengthStructureIssue(s,context);
  if(structureError){issues.push(makeIssue('STRENGTH_STRUCTURE_INVALID','blocking',structureError,[s.id]));unscheduled.push({session:s,reason:'Strength structure conflicts with the approved workout format.'});continue}
  const restrictionKeys=new Set(context.activeRestrictions.map(r=>r.trim().toLowerCase().replace(/\\s+/g,'_')));
  const proposedKeys=[...s.stressTags,...(s.strengthWorkout?.blocks.flatMap(b=>b.movements.map(m=>m.exerciseId))??[])].map(v=>v.trim().toLowerCase().replace(/\\s+/g,'_'));
  const restriction=proposedKeys.find(key=>restrictionKeys.has(key));
  if(restriction){issues.push(makeIssue('EXERCISE_RESTRICTED','blocking','The proposed session includes an exercise or stressor covered by an active athlete restriction.',[s.id]));unscheduled.push({session:s,reason:'Active athlete restriction.'});continue}
  if(s.evidenceRefs.length===0&&(s.priority==='competition'||s.priority==='key'||hardDemand(s)))issues.push(makeIssue('MISSING_EVIDENCE','review','A key or high-demand session lacks traceable evidence.',[s.id]));
  const candidates=s.fixedDay?[s.fixedDay]:(s.preferredDays?.length?s.preferredDays:available);
  const validDays=candidates.filter(day=>available.includes(day));
  if(!validDays.length){issues.push(makeIssue('FIXED_DAY_UNAVAILABLE','blocking','A required session day is unavailable; the planner will not silently move a fixed commitment.',[s.id],candidates));unscheduled.push({session:s,reason:'Required day unavailable.'});continue}
  const options=validDays.filter(day=>days[idx(day)].sessions.length<maxPerDay).map(day=>{
   const existing=days[idx(day)].sessions;
   const hardCount=existing.filter(hardDemand).length;
   const tagCount=existing.filter(e=>overlap(e,s)).length;
   const sportCount=existing.filter(e=>e.sport===s.sport).length;
   const adjacent=[idx(day)-1,idx(day)+1].filter(i=>i>=0&&i<7).flatMap(i=>days[i].sessions).filter(e=>hardDemand(e)&&(hardDemand(s)||overlap(e,s))).length;
   const totalMinutes=days.reduce((sum,d)=>sum+d.sessions.reduce((n,e)=>n+(e.durationMinutes??0),0),0);
   return{day,score:hardCount*100+tagCount*45+adjacent*24+sportCount*8+existing.length*4+totalMinutes*.001};
  }).sort((a,b)=>a.score-b.score||idx(a.day)-idx(b.day));
  if(!options.length){const key=s.priority==='key'||s.priority==='competition';issues.push(makeIssue(key?'UNSCHEDULED_KEY_SESSION':'FIXED_DAY_UNAVAILABLE',key?'blocking':'review','No available day has capacity.',[s.id]));unscheduled.push({session:s,reason:'No available day has capacity.'});continue}
  days[idx(options[0].day)].sessions.push(s);
 }
 const scheduled=days.flatMap(d=>d.sessions);
 for(const sport of context.requiredSports)if(!scheduled.some(s=>s.sport===sport))issues.push(makeIssue('REQUIRED_SPORT_MISSING','blocking','Required sport exposure is missing: '+sport+'.'));
 for(const d of days){const hard=d.sessions.filter(hardDemand);if(hard.length>1)issues.push(makeIssue('MULTIPLE_HARD_SESSIONS_SAME_DAY','review','More than one high-demand session lands on this day; review sequencing and recovery.',hard.map(s=>s.id),[d.day]))}
 for(let i=0;i<6;i++){const a=days[i].sessions.filter(hardDemand),b=days[i+1].sessions.filter(hardDemand);if(a.length&&b.length)issues.push(makeIssue('ADJACENT_HIGH_DEMAND_DAYS','review','Adjacent high-demand days may be intentional but require recovery and local-stress review.',[...a,...b].map(s=>s.id),[days[i].day,days[i+1].day]))}
 const blocked=issues.some(x=>x.severity==='blocking');
 return{version:1,goalId:context.primaryGoal.id,primaryGoal:context.primaryGoal.label,days,unscheduled,issues,status:blocked?'blocked':'review_required',
 rationale:['Primary goal sets weekly priority; secondary goals are fitted around it.','Sport-specific demand dimensions remain separate; no modality equivalency ratio is used.','Key and high-demand intents are placed before supporting and optional sessions.','This is a draft only; the Training domain must review and apply it through its canonical writer.'],
 invariants:{sportsKeptSeparate:true,noAutomaticPlanWrite:true,noInventedPrescription:true}};
}

export type TrainingDaySelfReport={fatigue:'normal'|'elevated'|'high'|'unknown';soreness:'none'|'mild'|'moderate'|'severe'|'unknown';sleep:'usual'|'poor'|'very_poor'|'unknown';performance:'normal'|'below_expected'|'unknown';painOrIllnessConcern:boolean;athleteNote?:string|null};
export type TrainingDayAdaptation={action:'keep'|'reduce'|'replace_with_easy'|'recovery'|'review';confidence:'low'|'moderate'|'high';reasonCodes:string[];recommendation:string;preservesOriginalPlan:true;requiresAthleteApproval:true};
export function adaptTrainingDay(input:{planned:TrainingSessionIntent|null;report:TrainingDaySelfReport;recentPattern?:'none'|'repeated_fatigue'|'repeated_underperformance'|'unknown'}):TrainingDayAdaptation{
 const{planned,report}=input;
 if(report.painOrIllnessConcern||report.soreness==='severe')return{action:'review',confidence:'high',reasonCodes:['PAIN_OR_ILLNESS_REQUIRES_REVIEW'],recommendation:'Do not force the planned session. Clarify the concern and use the appropriate safety/return-to-training pathway before proposing a replacement.',preservesOriginalPlan:true,requiresAthleteApproval:true};
 const elevated=report.fatigue==='elevated'||report.fatigue==='high'||report.soreness==='moderate'||report.sleep==='very_poor'||report.performance==='below_expected';
 const repeated=input.recentPattern==='repeated_fatigue'||input.recentPattern==='repeated_underperformance';
 if(!elevated)return{action:'keep',confidence:report.fatigue==='normal'&&report.performance==='normal'?'moderate':'low',reasonCodes:['NO_CLEAR_ADVERSE_SIGNAL'],recommendation:'Keep the planned session intent. Unknown or isolated wearable/context signals alone do not justify changing the plan.',preservesOriginalPlan:true,requiresAthleteApproval:true};
 if(repeated||report.fatigue==='high'||report.soreness==='moderate')return{action:planned?.priority==='competition'||planned?.priority==='key'?'review':'recovery',confidence:repeated?'high':'moderate',reasonCodes:[repeated?'REPEATED_ADVERSE_PATTERN':'ELEVATED_FATIGUE_OR_SORENESS','DO_NOT_MAKE_UP_MISSED_LOAD'],recommendation:'Reassess recent Training and Recovery. Protect key sessions; reduce optional/supporting stress first. A plan change requires review.',preservesOriginalPlan:true,requiresAthleteApproval:true};
 return{action:planned?.priority==='key'?'review':'reduce',confidence:'moderate',reasonCodes:['MULTI_SIGNAL_DAY_ADJUSTMENT','PRESERVE_SESSION_PURPOSE'],recommendation:'Consider a smaller dose while preserving the planned adaptation. Do not add missed work later automatically.',preservesOriginalPlan:true,requiresAthleteApproval:true};
}
