/** ALL-244 — Public Profile identity-only server boundary.
 * This is intentionally NOT PublicProfileScreenRead. A partial identity
 * response can never be promoted into an empty but "complete" post/event
 * timeline. The server must omit blocked identity and all nonpublic data.
 * No network connection or API permission is implemented here.
 */
export type CommunityIdentityPreview={
  status:'identity_only'|'blocked';
  ownerId:string;
  viewerId:string;
  displayName:string|null;
  profileVisibility:'public'|'private';
  relationship:'approved_follower'|'follow_requested'|'not_following'|'blocked_either_way';
  relationshipVersion:number;
};
export type CommunityIdentitySession={id:string|null;generation:number};
export type CommunityIdentityReader=(ownerId:string)=>Promise<unknown>;
export type CommunityIdentitySessionReader=()=>Promise<CommunityIdentitySession>;

const valid=(x:unknown,max=160):x is string=>
 typeof x==='string'&&x.length>0&&x.length<=max&&x===x.trim();

export function certifyCommunityIdentityPreview(
  input:unknown,expectedOwnerId:string,viewerId:string,
):CommunityIdentityPreview{
 if(!input||typeof input!=='object'||Array.isArray(input)||
    !valid(expectedOwnerId)||!valid(viewerId)||expectedOwnerId===viewerId)
  throw new Error('Invalid Community identity request or response.');
 const raw=input as Record<string,unknown>;
 const expectedFields=[
  'ownerId','viewerId','displayName','profileVisibility','relationship',
  'relationshipVersion','blocked','sharedArea','shareGeneralArea',
  'avatarPath','contentReady',
 ];
 // Never quietly discard over-fetched private fields (posts, events, area,
 // avatar paths, contact info or unknown future server payload shapes).
 if(Object.keys(raw).some(k=>!expectedFields.includes(k))||
    expectedFields.some(k=>!Object.prototype.hasOwnProperty.call(raw,k))||
    raw.ownerId!==expectedOwnerId||raw.viewerId!==viewerId||
    !Number.isSafeInteger(raw.relationshipVersion)||
    (raw.relationshipVersion as number)<1||
    !['public','private'].includes(raw.profileVisibility as string)||
    !['approved_follower','follow_requested','not_following','blocked_either_way']
     .includes(raw.relationship as string)||
    typeof raw.blocked!=='boolean'||raw.contentReady!==false||
    raw.sharedArea!==null||raw.shareGeneralArea!==false||raw.avatarPath!==null||
    !(raw.displayName===null||valid(raw.displayName,80)))
  throw new Error('Community identity-only reader over-fetched or returned invalid evidence.');
 const blocked=raw.relationship==='blocked_either_way';
 if(raw.blocked!==blocked||
    blocked&&(raw.displayName!==null||raw.profileVisibility!=='private'))
  throw new Error('Community identity-only reader leaked blocked athlete evidence.');
 return {
  status:blocked?'blocked':'identity_only',
  ownerId:expectedOwnerId,viewerId,
  displayName:raw.displayName as string|null,
  profileVisibility:raw.profileVisibility as 'public'|'private',
  relationship:raw.relationship as CommunityIdentityPreview['relationship'],
  relationshipVersion:raw.relationshipVersion as number,
 };
}

export async function readCertifiedCommunityIdentityPreview(args:{
  expectedOwnerId:string;
  active:CommunityIdentitySessionReader;
  reader:CommunityIdentityReader;
  isCurrent?:()=>boolean;
}):Promise<CommunityIdentityPreview>{
 const isCurrent=args.isCurrent??(()=>true);
 const before=await args.active();
 if(!before||!valid(before.id)||!Number.isSafeInteger(before.generation)||
    before.generation<0||!isCurrent())
  throw new Error('Community identity session unavailable.');
 const raw=await args.reader(args.expectedOwnerId);
 const after=await args.active();
 if(!isCurrent()||after.id!==before.id||after.generation!==before.generation)
  throw new Error('Community identity account changed during read.');
 return certifyCommunityIdentityPreview(raw,args.expectedOwnerId,before.id);
}
