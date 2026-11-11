/** ALL-244 — canonical Community post read boundary, NOT a network client.
 * Rows must be filtered at the server before any sensitive text is returned.
 * The certified relationship evidence is required separately for privacy:
 * readers must not hide over-fetched posts after receiving them.
 * More than 100 posts is incomplete, never an empty/completed feed.
 */
import {evaluatePublicProfileView,canViewProfilePost,type PublicProfileViewer}
 from './publicProfilePolicy.ts';
export type CommunityPostRow={
 id:string;ownerId:string;kind:'workout'|'food'|'update';
 audience:'public'|'followers'|'private';
 title:string;body:string;publishedAt:string;updatedAt:string;
};
export type CommunityPostsResponse={
 ownerId:string;viewerId:string;complete:boolean;nextCursor:string|null;
 blocked:boolean;posts:readonly CommunityPostRow[];
};
const str=(x:unknown,max=500):x is string=>
 typeof x==='string'&&x.length>0&&x.length<=max&&x===x.trim();
const time=(x:unknown):x is string=>
 typeof x==='string'&&Number.isFinite(Date.parse(x))&&x.includes('T');
export function certifyCommunityPostsRead(
 response:CommunityPostsResponse,expectedOwnerId:string,viewer:PublicProfileViewer,
):readonly CommunityPostRow[]{
 if(!response||response.ownerId!==expectedOwnerId||
  response.viewerId!==viewer.viewerId||viewer.ownerId!==expectedOwnerId||
  typeof response.blocked!=='boolean'||response.complete!==true||
  response.nextCursor!==null||!Array.isArray(response.posts)||
  response.posts.length>100)
  throw new Error('Community post owner read was partial, foreign or malformed.');
 const responseKeys=['ownerId','viewerId','complete','nextCursor','blocked','posts'];
 if(Object.keys(response).some(k=>!responseKeys.includes(k))||
    responseKeys.some(k=>!Object.prototype.hasOwnProperty.call(response,k)))
  throw new Error('Community reader returned unexpected private data or missing evidence.');
 const view=evaluatePublicProfileView(viewer);
 if(response.blocked!==(view.label==='blocked'))
  throw new Error('Community block evidence was contradictory.');
 if(response.blocked&&response.posts.length)
  throw new Error('Community server leaked blocked athlete posts.');
 const seen=new Set<string>();
 const result:CommunityPostRow[]=[];
 for(const post of response.posts){
  const postKeys=['id','ownerId','kind','audience','title','body',
   'publishedAt','updatedAt'];
  if(post&&typeof post==='object'&&
     (Object.keys(post).some(k=>!postKeys.includes(k))||
      postKeys.some(k=>!Object.prototype.hasOwnProperty.call(post,k))))
   throw new Error('Community post reader transmitted unexpected private fields.');
  if(!post||!str(post.id,150)||post.ownerId!==expectedOwnerId||
   seen.has(post.id)||!['workout','food','update'].includes(post.kind)||
   !['public','followers','private'].includes(post.audience)||
   !str(post.title,500)||typeof post.body!=='string'||post.body.length>4000||
   !time(post.publishedAt)||!time(post.updatedAt))
   throw new Error('Invalid Community post identity, type or content.');
  if(!canViewProfilePost(post.audience,view))
   throw new Error('Community reader returned an unauthorized post.');
  seen.add(post.id);
  result.push(post);
 }
 return result;
}
export async function readCertifiedCommunityPosts(args:{
 expectedOwnerId:string;
 active:()=>Promise<{id:string|null;generation:number}>;
 read:(ownerId:string)=>Promise<CommunityPostsResponse>;
 relationship:()=>Promise<PublicProfileViewer>;
 isCurrent?:()=>boolean;
}):Promise<readonly CommunityPostRow[]>{
 const isCurrent=args.isCurrent??(()=>true);
 const before=await args.active();
 if(!before.id||!Number.isSafeInteger(before.generation)||before.generation<0||
  !isCurrent())throw new Error('Community viewer session unavailable.');
 const prior=await args.relationship();
 if(prior.viewerId!==before.id||prior.ownerId!==args.expectedOwnerId)
  throw new Error('Foreign Community relationship evidence.');
 const response=await args.read(args.expectedOwnerId);
 const after=await args.active();
 if(!isCurrent()||after.id!==before.id||after.generation!==before.generation)
  throw new Error('Community account changed during post read.');
 return certifyCommunityPostsRead(response,args.expectedOwnerId,prior);
}
