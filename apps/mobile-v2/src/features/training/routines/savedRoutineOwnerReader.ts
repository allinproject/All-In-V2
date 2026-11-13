/**
 * ALL-246 authenticated Saved Routine reader boundary.
 *
 * This adapter does not create a Routine store, issue SQL, trust a client-
 * asserted owner, or infer an absent record from an unavailable endpoint.
 * The canonical Training owner must implement these services after ALL-222
 * approves Routine identity, versioned persistence, SELECT policy and grants.
 */
import {openOwnedRoutineWorkoutReview,type SavedRoutineOwnerSnapshot} from './routineWorkoutReview.ts';

export type SavedRoutineSummary={
  routineId:string;ownerId:string;version:number;name:string;sport:SavedRoutineOwnerSnapshot['sport'];
  updatedAt:string;isFavorite:boolean;
};
export type SavedRoutineListPage={
  expectedOwnerId:string;sessionGeneration:number;
  /** Owner-certified snapshot marker and complete-page attestation. */
  snapshotVersion:string;
  records:readonly SavedRoutineSummary[];
  hasMore:boolean;
  nextCursor:string|null;
};
export type SavedRoutineReadServices={
  /** Must verify a CURRENT authenticated session, not merely read a cached user ID. */
  authenticateOwner:(expectedOwnerId:string,sessionGeneration:number)=>Promise<void>;
  readListPage:(request:{expectedOwnerId:string;sessionGeneration:number;cursor:string|null;limit:number})=>Promise<SavedRoutineListPage>;
  readVersion:(request:{expectedOwnerId:string;sessionGeneration:number;routineId:string;version:number})=>Promise<SavedRoutineOwnerSnapshot|null>;
};
export type SavedRoutineListResult=
 |{status:'ready';ownerId:string;sessionGeneration:number;snapshotVersion:string;records:SavedRoutineSummary[]}
 |{status:'unavailable';records:[]};
export type SavedRoutineDetailResult=
 |{status:'ready';record:SavedRoutineOwnerSnapshot}
 |{status:'unavailable';record:null};

const failList=():SavedRoutineListResult=>({status:'unavailable',records:[]});
const failDetail=():SavedRoutineDetailResult=>({status:'unavailable',record:null});
const id=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=150&&/^[a-z0-9_:.\-]+$/i.test(v);
const token=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=200;
const version=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
const generation=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const clone=<T>(v:T):T=>JSON.parse(JSON.stringify(v)) as T;
const sportSet=new Set(['running','walking','cycling','swimming','strength','hiking',
  'rucking','rowing','elliptical','stair','yoga','mobility','other']);

function validSummary(s:SavedRoutineSummary,expectedOwnerId:string):boolean{
 return !!s&&id(s.routineId)&&s.ownerId===expectedOwnerId&&version(s.version)&&
 typeof s.name==='string'&&!!s.name.trim()&&s.name.length<=120&&
 sportSet.has(s.sport)&&typeof s.updatedAt==='string'&&
 s.updatedAt.length>0&&s.updatedAt.length<=100&&
 Number.isFinite(Date.parse(s.updatedAt))&&typeof s.isFavorite==='boolean';
}
/** Recheck the authenticated actor and active session on both sides of I/O.
 * A change of account/session or an incomplete page must fail CLOSED.
 */
export async function readAuthenticatedSavedRoutineList(
 expectedOwnerId:string,sessionGeneration:number,services:SavedRoutineReadServices,
 currentSession:()=>boolean=()=>true,
):Promise<SavedRoutineListResult>{
 if(!id(expectedOwnerId)||!generation(sessionGeneration)||!currentSession())return failList();
 try{
  await services.authenticateOwner(expectedOwnerId,sessionGeneration);
  if(!currentSession())return failList();
  const records:SavedRoutineSummary[]=[];
  const seenIds=new Set<string>();
  const seenCursors=new Set<string>();
  let cursor:string|null=null;
  let snapshotVersion:string|null=null;
  for(let pageNo=0;pageNo<50;pageNo++){
   if(!currentSession())return failList();
   const page=await services.readListPage({expectedOwnerId,sessionGeneration,cursor,limit:100});
   if(!currentSession()||!page||page.expectedOwnerId!==expectedOwnerId||
      page.sessionGeneration!==sessionGeneration||!token(page.snapshotVersion)||
      !Array.isArray(page.records)||page.records.length>100||
      typeof page.hasMore!=='boolean')return failList();
   if(snapshotVersion!==null&&page.snapshotVersion!==snapshotVersion)return failList();
   snapshotVersion=page.snapshotVersion;
   for(const record of page.records){
    if(!validSummary(record,expectedOwnerId)||seenIds.has(record.routineId))return failList();
    seenIds.add(record.routineId);records.push(clone(record));
   }
   if(!page.hasMore){
    if(page.nextCursor!==null)return failList();
    await services.authenticateOwner(expectedOwnerId,sessionGeneration);
    if(!currentSession())return failList();
    return {status:'ready',ownerId:expectedOwnerId,sessionGeneration,
      snapshotVersion,records};
   }
   if(!token(page.nextCursor)||page.records.length===0||
      seenCursors.has(page.nextCursor))return failList();
   seenCursors.add(page.nextCursor);cursor=page.nextCursor;
  }
 }catch{/* Unapproved, inaccessible or disconnected owner reader stays unavailable. */}
 return failList();
}
/** Read a selected immutable version, NEVER silently upgrade to latest. */
export async function readAuthenticatedSavedRoutineVersion(
 request:{expectedOwnerId:string;sessionGeneration:number;routineId:string;version:number},
 services:SavedRoutineReadServices,currentSession:()=>boolean=()=>true,
):Promise<SavedRoutineDetailResult>{
 const {expectedOwnerId,sessionGeneration,routineId,version:requestedVersion}=request;
 if(!id(expectedOwnerId)||!generation(sessionGeneration)||!id(routineId)||
    !version(requestedVersion)||!currentSession())return failDetail();
 try{
  await services.authenticateOwner(expectedOwnerId,sessionGeneration);
  if(!currentSession())return failDetail();
  const item=await services.readVersion(request);
  if(!currentSession()||!item||item.routineId!==routineId||
     item.version!==requestedVersion||
     !openOwnedRoutineWorkoutReview(item,expectedOwnerId,sessionGeneration))return failDetail();
  await services.authenticateOwner(expectedOwnerId,sessionGeneration);
  if(!currentSession())return failDetail();
  return {status:'ready',record:clone(item)};
 }catch{return failDetail();}
}
