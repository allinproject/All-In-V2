/** ALL-244/251 — privacy visibility lifecycle for the future canonical owner.
 * No SQL deployment, network connection, optimistic UI write, or substitute
 * settings storage. The server owns all current visibility and version data.
 */
export type CommunityProfileVisibility='public'|'private';
export type VisibilitySnapshot={
  ownerId:string;visibility:CommunityProfileVisibility;version:number;
};
export type VisibilityWriteReceipt=VisibilitySnapshot&{changed:boolean};
export type VisibilitySession={id:string|null;generation:number};
export type VisibilitySessionReader=()=>Promise<VisibilitySession>;
export type VisibilityOwnerReader=()=>Promise<VisibilitySnapshot>;
export type VisibilityOwnerWriter=(args:{
  expectedOwnerId:string;nextVisibility:CommunityProfileVisibility;
  expectedVersion:number;
})=>Promise<VisibilityWriteReceipt>;

function certifySnapshot(value:VisibilitySnapshot,expectedId:string):void{
 if(!value||value.ownerId!==expectedId||
    !['public','private'].includes(value.visibility)||
    !Number.isSafeInteger(value.version)||value.version<1)
   throw new Error('Invalid or foreign Community visibility evidence.');
}
function certifySession(value:VisibilitySession,expectedId:string,generation?:number):void{
 if(!value||value.id!==expectedId||
    !Number.isSafeInteger(value.generation)||value.generation<0||
    generation!==undefined&&value.generation!==generation)
   throw new Error('Community account changed during privacy update.');
}
/** Only certified fresh readback can tell a profile screen that it changed.
 * Failed/ambiguous writes must not be treated as optimistic success.
 */
export async function changeCertifiedCommunityVisibility(args:{
 expectedOwnerId:string;
 nextVisibility:CommunityProfileVisibility;
 active:VisibilitySessionReader;
 read:VisibilityOwnerReader;
 write:VisibilityOwnerWriter;
 isCurrent?:()=>boolean;
}):Promise<VisibilitySnapshot>{
 const {expectedOwnerId,nextVisibility,active,read,write}=args;
 const current=args.isCurrent??(()=>true);
 if(!['public','private'].includes(nextVisibility))
   throw new Error('Invalid requested Community visibility.');
 const starting=await active();
 certifySession(starting,expectedOwnerId);
 if(!current())throw new Error('Community privacy screen is no longer active.');
 const before=await read();
 certifySnapshot(before,expectedOwnerId);
 certifySession(await active(),expectedOwnerId,starting.generation);
 if(!current())throw new Error('Community privacy screen is no longer active.');
 const receipt=await write({
  expectedOwnerId,nextVisibility,expectedVersion:before.version,
 });
 certifySession(await active(),expectedOwnerId,starting.generation);
 if(!current())throw new Error('Community privacy screen is no longer active.');
 if(!receipt||typeof receipt.changed!=='boolean'||
    receipt.ownerId!==expectedOwnerId||
    receipt.visibility!==nextVisibility||
    !Number.isSafeInteger(receipt.version)||
    receipt.version!==before.version+(receipt.changed?1:0)||
    (receipt.changed===false&&before.visibility!==nextVisibility)||
    (receipt.changed===true&&before.visibility===nextVisibility))
   throw new Error('Unverified Community visibility write receipt.');
 const after=await read();
 certifySession(await active(),expectedOwnerId,starting.generation);
 if(!current())throw new Error('Community privacy screen is no longer active.');
 certifySnapshot(after,expectedOwnerId);
 if(after.version!==receipt.version||after.visibility!==nextVisibility)
   throw new Error('Community visibility requires a matching current owner read.');
 return after;
}
