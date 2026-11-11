/** ALL-244 EventHub membership mutation boundary.
 * Canonical event/course evidence belongs to ALL-234, NOT to this module.
 * EventHub owns only an athlete's explicit membership and participant visibility.
 * No real API, event directory, registration evidence, post syndication or
 * automatic membership is introduced by this client-only contract.
 */
import type {EventHubResolution} from './eventHubUrlIntent.ts';

export type EventHubMemberAction='join'|'leave'|'show_participation'|'hide_participation';
export type EventHubMemberSnapshot={
 athleteId:string;eventId:string;groupId:string;
 verifiedEventIdentity:boolean;
 joined:boolean;participantVisible:boolean;joinedAt:string|null;version:number;
};
export type EventHubMemberIntent={
 actorId:string;eventId:string;groupId:string;action:EventHubMemberAction;
 actionId:string;expectedVersion:number;
};
export type EventHubMemberReceipt={
 actorId:string;eventId:string;groupId:string;action:EventHubMemberAction;
 actionId:string;version:number;accepted:boolean;
};
export type EventHubAccount={id:string|null;generation:number};
export type EventHubMembershipReader=()=>Promise<EventHubMemberSnapshot>;
export type EventHubMembershipWriter=(intent:EventHubMemberIntent)=>Promise<EventHubMemberReceipt>;
const uuid=(v:unknown)=>typeof v==='string'&&
 /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(v)&&
 v!=='00000000-0000-0000-0000-000000000000';
const timestamp=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&v.includes('T');

function validateMember(s:EventHubMemberSnapshot,actor:string,event:string,group:string){
 if(!s||s.athleteId!==actor||s.eventId!==event||s.groupId!==group||
  !uuid(s.athleteId)||!uuid(s.eventId)||!uuid(s.groupId)||
  s.verifiedEventIdentity!==true||
  typeof s.joined!=='boolean'||typeof s.participantVisible!=='boolean'||
  !Number.isSafeInteger(s.version)||s.version<1||
  (s.joined&&!timestamp(s.joinedAt))||
  (!s.joined&&(s.joinedAt!==null||s.participantVisible)))
   throw new Error('Invalid or foreign EventHub membership evidence.');
}
function validateSession(s:EventHubAccount,actor:string,generation?:number){
 if(!s||s.id!==actor||!Number.isSafeInteger(s.generation)||s.generation<0||
   (generation!==undefined&&s.generation!==generation))
  throw new Error('EventHub account changed during membership action.');
}
function intendedOutcome(action:EventHubMemberAction,s:EventHubMemberSnapshot){
 if(action==='join')return s.joined&&!s.participantVisible;
 if(action==='leave')return !s.joined&&!s.participantVisible;
 if(action==='show_participation')return s.joined&&s.participantVisible;
 return s.joined&&!s.participantVisible;
}
/** A matched organizer URL identifies a group. It NEVER enrolls the athlete.
 * Only a separately confirmed membership writer can mark joined=true.
 */
export async function executeCertifiedEventHubMembership(args:{
 actorId:string;eventId:string;groupId:string;actionId:string;
 action:EventHubMemberAction;
 active:()=>Promise<EventHubAccount>;
 read:EventHubMembershipReader;
 write:EventHubMembershipWriter;
 resolution?:EventHubResolution;
 isCurrent?:()=>boolean;
}):Promise<EventHubMemberSnapshot>{
 const {actorId,eventId,groupId,actionId,action,active,read,write}=args;
 const current=args.isCurrent??(()=>true);
 if(!uuid(actorId)||!uuid(eventId)||!uuid(groupId)||!uuid(actionId))
  throw new Error('Canonical EventHub UUID identity and action are required.');
 if(!['join','leave','show_participation','hide_participation'].includes(action))
  throw new Error('Unknown EventHub membership action.');
 if(action==='join'){
  const r=args.resolution;
  if(!r||r.status!=='matched'||r.verifiedIdentity!==true||r.joined!==false||
   r.actorId!==actorId||r.eventId!==eventId||r.groupId!==groupId)
   throw new Error('EventHub join needs a verified exact event URL resolution.');
 }
 const start=await active();
 validateSession(start,actorId);
 if(!current())throw new Error('EventHub screen no longer active.');
 const before=await read();
 validateSession(await active(),actorId,start.generation);
 if(!current())throw new Error('EventHub screen no longer active.');
 validateMember(before,actorId,eventId,groupId);
 if(action==='join'&&before.joined ||
    action==='leave'&&!before.joined||
    action==='show_participation'&&(!before.joined||before.participantVisible)||
    action==='hide_participation'&&(!before.joined||!before.participantVisible))
  throw new Error('EventHub membership action unavailable in current state.');
 const intent:EventHubMemberIntent={actorId,eventId,groupId,action,actionId,
  expectedVersion:before.version};
 const receipt=await write(intent);
 validateSession(await active(),actorId,start.generation);
 if(!current())throw new Error('EventHub screen no longer active.');
 if(!receipt||receipt.actorId!==actorId||receipt.eventId!==eventId||
  receipt.groupId!==groupId||receipt.action!==action||
  receipt.actionId!==actionId||receipt.accepted!==true||
  receipt.version!==before.version+1)
  throw new Error('Unverified EventHub membership write receipt.');
 const after=await read();
 validateSession(await active(),actorId,start.generation);
 if(!current())throw new Error('EventHub screen no longer active.');
 validateMember(after,actorId,eventId,groupId);
 if(after.version!==receipt.version||!intendedOutcome(action,after))
  throw new Error('EventHub membership receipt lacks a fresh owner-confirmed result.');
 return after;
}
