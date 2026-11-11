/**
 * ALL-231: reconcile each event requiring course-specific preparation with
 * the existing race-course evidence owner. Does not infer route or aid facts.
 */
import {validateRaceCourseEvidence,type RaceCourseEvidence} from './raceCourseEvidence.ts';
import type {SeasonPlanDraft} from './multiEventSeasonPlan.ts';

export type SeasonCourseIssue={
 code:'MISSING_COURSE'|'EVENT_IDENTITY_MISMATCH'|'DUPLICATE_COURSE'|
  'COURSE_FACTS_INCOMPLETE'|'UNEXPECTED_COURSE';
 eventId:string;message:string;missingFields:string[];
};
export type SeasonCourseReview={
 status:'review_required'|'ready_for_course_planning';
 courses:Array<{eventId:string;courseVersion:string;sourceUrls:string[];
  completeness:'verified'|'partial'|'unverified';missingFields:string[]}>;
 issues:SeasonCourseIssue[];
 noInventedCourseFacts:true;
};
export function reviewMultiEventCourseEvidence(input:{
 season:SeasonPlanDraft;
 courseRequiredEventIds:readonly string[];
 courseEvidence:readonly RaceCourseEvidence[];
}):SeasonCourseReview{
 const {season,courseRequiredEventIds,courseEvidence}=input??{};
 if(!season||season.status==='blocked'||!Array.isArray(season.events)||
    !Array.isArray(courseRequiredEventIds)||!Array.isArray(courseEvidence))
  throw Error('Valid coordinated season and explicit course requirements required.');
 const events=new Map(season.events.map(e=>[e.id,e]));
 if(events.size!==season.events.length)throw Error('Distinct event identities required.');
 const required=new Set<string>();
 for(const id of courseRequiredEventIds){
  if(!events.has(id)||required.has(id))throw Error('Course requirement must refer to one known event.');
  required.add(id);
 }
 const courses:SeasonCourseReview['courses']=[];
 const issues:SeasonCourseIssue[]=[];
 const seen=new Set<string>();
 for(const raw of courseEvidence){
  if(!raw||typeof raw.raceId!=='string')throw Error('Course must identify a canonical event.');
  if(seen.has(raw.raceId)){
   issues.push({code:'DUPLICATE_COURSE',eventId:raw.raceId,
    message:'Multiple course revisions supplied for one event; require a single approved version.',missingFields:[]});
   continue;
  }
  seen.add(raw.raceId);
  const event=events.get(raw.raceId);
  if(!event||!required.has(raw.raceId)){
   issues.push({code:'UNEXPECTED_COURSE',eventId:raw.raceId,
    message:'Course evidence does not match a course-required event in this season.',missingFields:[]});
   continue;
  }
  if(event.date!==raw.eventDate){
   issues.push({code:'EVENT_IDENTITY_MISMATCH',eventId:event.id,
    message:'Course version event date differs from canonical season event date.',missingFields:[]});
   continue;
  }
  let valid:RaceCourseEvidence;
  try{valid=validateRaceCourseEvidence(raw);}
  catch{
   issues.push({code:'COURSE_FACTS_INCOMPLETE',eventId:event.id,
    message:'Race course evidence failed field provenance or route validation.',missingFields:['invalid_evidence']});
   continue;
  }
  courses.push({eventId:event.id,courseVersion:valid.courseVersion,
   sourceUrls:[...valid.sourceUrls],completeness:valid.completeness,missingFields:[...valid.missingFields]});
  if(valid.completeness!=='verified')
   issues.push({code:'COURSE_FACTS_INCOMPLETE',eventId:event.id,
    message:'Course-specific workouts or race strategy need confirmed missing details.',missingFields:[...valid.missingFields]});
 }
 for(const id of required){
  if(!seen.has(id))issues.push({code:'MISSING_COURSE',eventId:id,
   message:'No verified course evidence provided for the event.',missingFields:['course']});
 }
 return{status:issues.length?'review_required':'ready_for_course_planning',
  courses,issues,noInventedCourseFacts:true};
}
