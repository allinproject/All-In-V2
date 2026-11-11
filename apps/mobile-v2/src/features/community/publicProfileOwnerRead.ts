/** ALL-244: owner-certified Public Profile read boundary.
 * The Community backend is responsible for RLS, blocked relationship checks,
 * current approval evidence and cursor-complete data. This client code is
 * defense-in-depth only: it does NOT grant permissions or query undeployed SQL.
 */
import {evaluatePublicProfileView,canViewProfilePost,canDisplayRaceParticipation,
 type PublicProfileViewer,type PublicProfileAudience,type PublicProfileView,
} from './publicProfilePolicy.ts';

export type CanonicalProfilePost={
 id:string;ownerId:string;audience:PublicProfileAudience;title:string;
};
export type CanonicalRaceParticipation={
 id:string;ownerId:string;audience:PublicProfileAudience;eventName:string;
};
export type CanonicalPublicProfileSnapshot={
 ownerId:string;viewerId:string|null;sessionGeneration:number;
 revision:number;complete:boolean;nextCursor:string|null;
 profile:PublicProfileViewer;
 /** Data already owner/relationship authorized by Community canonical reader. */
 posts:readonly CanonicalProfilePost[];
 races:readonly CanonicalRaceParticipation[];
 displayName:string|null;
};
export type PublicProfileScreenRead={
 status:'ready'|'blocked';
 displayName:string|null;
 profile:PublicProfileView;
 posts:readonly CanonicalProfilePost[];
 races:readonly CanonicalRaceParticipation[];
 revision:number;
};
export type PublicProfileReader=(args:{
 expectedOwnerId:string;viewerId:string|null;
})=>Promise<CanonicalPublicProfileSnapshot>;
export type ActiveViewerReader=()=>Promise<{id:string|null;generation:number}>;
const valid=(x:unknown,max=250)=>typeof x==='string'&&x.trim().length>0&&x.trim()===x&&x.length<=max;
const audience=(x:unknown):x is PublicProfileAudience=>['public','followers','private'].includes(x as string);

export function certifyPublicProfileSnapshot(
 snapshot:CanonicalPublicProfileSnapshot,expectedOwnerId:string,viewerId:string|null,
 generation:number,
):PublicProfileScreenRead{
 if(!valid(expectedOwnerId)||snapshot.ownerId!==expectedOwnerId||
 snapshot.viewerId!==viewerId||snapshot.sessionGeneration!==generation||
 !Number.isSafeInteger(generation)||generation<0||
 !Number.isSafeInteger(snapshot.revision)||snapshot.revision<1||
 !snapshot.complete||snapshot.nextCursor!==null||
 !Array.isArray(snapshot.posts)||!Array.isArray(snapshot.races)||
 snapshot.posts.length>1000||snapshot.races.length>1000||
 snapshot.profile.ownerId!==expectedOwnerId||snapshot.profile.viewerId!==viewerId)
  throw new Error('Incomplete, stale or foreign Community profile read.');
 const view=evaluatePublicProfileView(snapshot.profile);
 // Blocked users receive no profile identity, posts or race data.
 if(view.label==='blocked')return{status:'blocked',displayName:null,profile:view,posts:[],races:[],revision:snapshot.revision};
 if(snapshot.displayName!==null&&
  (typeof snapshot.displayName!=='string'||snapshot.displayName.length>80))
  throw new Error('Invalid public profile display name.');
 const ids=new Set<string>();
 for(const post of snapshot.posts){
  if(!valid(post.id)||post.ownerId!==expectedOwnerId||!audience(post.audience)||
   !valid(post.title,500)||ids.has('post:'+post.id))
   throw new Error('Invalid Community post evidence.');
  ids.add('post:'+post.id);
 }
 for(const race of snapshot.races){
  if(!valid(race.id)||race.ownerId!==expectedOwnerId||!audience(race.audience)||
   !valid(race.eventName,250)||ids.has('race:'+race.id))
   throw new Error('Invalid Community event evidence.');
  ids.add('race:'+race.id);
 }
 return {status:'ready',displayName:snapshot.displayName,profile:view,
  posts:snapshot.posts.filter(p=>canViewProfilePost(p.audience,view)),
  races:snapshot.races.filter(r=>canDisplayRaceParticipation(r.audience,view)),
  revision:snapshot.revision};
}
/** Check the account generation on both sides of an async load.
 * A new session with same user ID still invalidates an old read.
 */
export async function readCertifiedPublicProfile(
 expectedOwnerId:string,active:ActiveViewerReader,reader:PublicProfileReader,
 isCurrent:()=>boolean=()=>true,
):Promise<PublicProfileScreenRead>{
 if(!valid(expectedOwnerId))throw new Error('Target athlete is required.');
 const before=await active();
 if(!isCurrent())throw new Error('Community profile view is no longer active.');
 const snapshot=await reader({expectedOwnerId,viewerId:before.id});
 const after=await active();
 if(!isCurrent()||after.id!==before.id||after.generation!==before.generation)
  throw new Error('Community account changed during profile read.');
 return certifyPublicProfileSnapshot(snapshot,expectedOwnerId,before.id,before.generation);
}
