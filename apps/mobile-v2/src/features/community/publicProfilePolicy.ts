/** ALL-244/251 — pure Public Profile visibility decision boundary.
 * These are defense-in-depth UI decisions, NOT authorization. The canonical
 * Community owner must apply the equivalent policy in its authenticated
 * server read/RLS and never trust client-supplied relationship assertions.
 */
export type PublicProfileVisibility='public'|'private';
export type PublicProfileRelationship='self'|'approved_follower'|'follow_requested'|'not_following'|'blocked_either_way';
export type PublicProfileAudience='public'|'followers'|'private';
export type PublicProfileViewer={
 ownerId:string;
 viewerId:string|null;
 profileVisibility:PublicProfileVisibility;
 relationship:PublicProfileRelationship;
 /** A stored optional area is NEVER displayed without explicit share opt-in. */
 sharedArea:string|null;
 shareGeneralArea:boolean;
};
export type PublicProfileView={
 canViewIdentity:boolean;
 canViewPrivateContent:boolean;
 canRequestToFollow:boolean;
 canFollowDirectly:boolean;
 canApproveRequests:boolean;
 canInteract:boolean;
 visibleGeneralArea:string|null;
 label:'own_profile'|'public_profile'|'private_profile'|'follow_request_pending'|'blocked';
};
export function evaluatePublicProfileView(input:PublicProfileViewer):PublicProfileView{
 if(!input.ownerId.trim()||!['public','private'].includes(input.profileVisibility)||
 !['self','approved_follower','follow_requested','not_following','blocked_either_way'].includes(input.relationship))
  throw new Error('Invalid canonical public profile evidence.');
 const isSelf=input.viewerId!==null&&input.viewerId===input.ownerId;
 if(isSelf!== (input.relationship==='self'))
  throw new Error('Public profile viewer relationship does not match owner identity.');
 const blocked=input.relationship==='blocked_either_way';
 if(blocked)return {canViewIdentity:false,canViewPrivateContent:false,canRequestToFollow:false,
  canFollowDirectly:false,canApproveRequests:false,canInteract:false,visibleGeneralArea:null,label:'blocked'};
 const follows=input.relationship==='approved_follower';
 const canViewPrivateContent=isSelf||follows;
 const visibility=input.profileVisibility;
 const area=typeof input.sharedArea==='string'&&input.sharedArea.trim()?input.sharedArea.trim().slice(0,80):null;
 return {
  canViewIdentity:true,canViewPrivateContent,
  canRequestToFollow:input.viewerId!==null&&!isSelf&&visibility==='private'&&input.relationship==='not_following',
  canFollowDirectly:input.viewerId!==null&&!isSelf&&visibility==='public'&&input.relationship==='not_following',
  canApproveRequests:isSelf,
  canInteract:input.viewerId!==null&&!isSelf&&(visibility==='public'||follows),
  visibleGeneralArea:input.shareGeneralArea&&(isSelf||visibility==='public'||follows)?area:null,
  label:isSelf?'own_profile':input.relationship==='follow_requested'?'follow_request_pending':
   visibility==='private'&&!follows?'private_profile':'public_profile',
 };
}
/** Gate each post with its own audience even when the profile is public.
 * This is NOT a substitute for post-owner RLS, block checks and privacy ACL.
 */
export function canViewProfilePost(audience:PublicProfileAudience,profile:PublicProfileView):boolean{
 if(profile.label==='blocked')return false;
 if(audience==='private')return profile.label==='own_profile';
 if(audience==='followers')return profile.canViewPrivateContent;
 // A private account is not made readable by an individual post marked public.
 // Followers and the owner can see that post; unapproved viewers cannot.
 return profile.label==='public_profile'||profile.label==='own_profile'||profile.canViewPrivateContent;
}
/** An event/race participation must be independently permission checked.
 * Never infer race sharing from the athlete's public profile visibility.
 */
export function canDisplayRaceParticipation(
 eventAudience:PublicProfileAudience,profile:PublicProfileView,
):boolean{return canViewProfilePost(eventAudience,profile);}
