/** ALL-244 / ALL-243 / ALL-247: cross-domain Community share proposal.
 * Training/Completed Activity and Fuel own their canonical source IDs.
 * Community may create exactly ONE post only after a user explicitly shares.
 * This client preflight never publishes or authorizes a server write.
 * Source owner MUST re-read the original record and verify its revision.
 */
export type CommunitySourceKind='workout'|'food';
export type CommunitySourceEvidence={
 sourceKind:CommunitySourceKind;sourceId:string;sourceOwnerId:string;
 sourceVersion:number;
 /** Source owner confirms actually finished, not planned or suggested. */
 sourceState:'completed'|'planned'|'imported_unreviewed'|'suggested';
 /** Explicit completion evidence, not an inferred import. */
 verifiedCanonicalSource:boolean;
};
export type CommunityShareIntent={
 actorId:string;postId:string;actionId:string;
 sourceKind:CommunitySourceKind;sourceId:string;sourceVersion:number;
 audience:'public'|'followers'|'private';
 /** Must be verified again by the Community owner server. */
 explicitAthleteApproval:true;
};
const uuid=(x:unknown)=>typeof x==='string'&&
 /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x)&&
 x!=='00000000-0000-0000-0000-000000000000';
export function prepareCanonicalSourceShare(args:{
 actorId:string;postId:string;actionId:string;
 source:CommunitySourceEvidence;
 audience:'public'|'followers'|'private';
 explicitAthleteApproval:boolean;
}):CommunityShareIntent{
 const {actorId,postId,actionId,source,audience,explicitAthleteApproval}=args;
 if(!uuid(actorId)||!uuid(postId)||!uuid(actionId)||!source||
  !['workout','food'].includes(source.sourceKind)||
  !uuid(source.sourceId)||source.sourceOwnerId!==actorId||
  !Number.isSafeInteger(source.sourceVersion)||source.sourceVersion<1||
  source.verifiedCanonicalSource!==true||
  source.sourceState!=='completed'||
  explicitAthleteApproval!==true||
  !['public','followers','private'].includes(audience))
  throw new Error('Canonical completed source and explicit athlete approval required.');
 return {actorId,postId,actionId,sourceKind:source.sourceKind,
  sourceId:source.sourceId,sourceVersion:source.sourceVersion,
  audience,explicitAthleteApproval:true};
}
