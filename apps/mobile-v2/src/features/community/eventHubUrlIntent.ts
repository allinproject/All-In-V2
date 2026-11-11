/** ALL-244 EventHub URL-submission contract.
 * EventHub is not a discovery directory. A user supplies a particular event
 * website; the owner service resolves its exact canonical event/group.
 * This module does NOT fetch websites, verify registration or create a group.
 * Backend must independently validate redirects, DNS, SSRF, URL aliases,
 * event identity and athlete-initiated membership in one canonical owner.
 */
export type EventHubUrlIntent={
  actorId:string;actionId:string;submittedUrl:string;
  /** Input URL only; not a verified canonical event identity. */
  inputUrl:string;
};
export type EventHubResolution={
  actorId:string;actionId:string;submittedUrl:string;
  status:'matched'|'needs_evidence'|'conflict';
  eventId:string|null;groupId:string|null;
  /** Server-certified owner evidence; not merely URL string equality. */
  verifiedIdentity:boolean;
  joined:boolean;
};
function valid(value:unknown,max=160):value is string{
 return typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max;
}
const localHosts=new Set(['localhost','localhost.localdomain','host.docker.internal']);
const tracking=(key:string)=>/^(utm_[a-z0-9_]+|gclid|fbclid|msclkid|mc_cid|mc_eid)$/i.test(key);
function isNonPublicIPv4(h:string):boolean{
 if(!/^\d+(?:\.\d+){3}$/.test(h))return false;
 const bytes=h.split('.').map(Number);
 return bytes.some(x=>x<0||x>255)||
  bytes[0]===0||bytes[0]===10||bytes[0]===127||
  bytes[0]>=224||bytes[0]===169&&bytes[1]===254||
  bytes[0]===172&&bytes[1]>=16&&bytes[1]<=31||
  bytes[0]===192&&bytes[1]===168||
  bytes[0]===100&&bytes[1]>=64&&bytes[1]<=127;
}
/** Conservative user input hygiene, NOT a server-side SSRF guarantee. */
export function normalizeEventHubInputUrl(source:string):string{
 if(typeof source!=='string'||source.length>2048||source!==source.trim())
  throw new Error('A valid event website URL is required.');
 let u:URL;
 try{u=new URL(source);}catch{throw new Error('A valid event website URL is required.');}
 const host=u.hostname.toLowerCase().replace(/\.$/,'');
 if(u.protocol!=='https:'||u.username||u.password||!host||host.length>253||
  localHosts.has(host)||host.endsWith('.local')||host.endsWith('.internal')||
  host==='[::1]'||host.startsWith('[')||isNonPublicIPv4(host)||
  !host.includes('.')||u.port&&u.port!=='443')
  throw new Error('Use a public HTTPS event website URL.');
 u.hash='';
 for(const key of [...u.searchParams.keys()]){
  if(tracking(key))u.searchParams.delete(key);
 }
 // Retain event ID, heat, distance and other organizer query parameters.
 // Never merge distinct URLs without a verified canonical owner match.
 return u.toString();
}
export function prepareEventHubUrlIntent(
 actorId:string,actionId:string,submittedUrl:string,
):EventHubUrlIntent{
 if(!valid(actorId)||!valid(actionId))
  throw new Error('Signed-in athlete and stable action ID are required.');
 return {actorId,actionId,submittedUrl,inputUrl:normalizeEventHubInputUrl(submittedUrl)};
}
/** An organizer URL or resolved group does not prove event registration,
 * attendance, race completion or result verification. Joining a group is
 * distinct from evidence of those athlete states.
 */
export function certifyEventHubUrlResolution(
 intent:EventHubUrlIntent,receipt:EventHubResolution,
):EventHubResolution{
 if(receipt.actorId!==intent.actorId||receipt.actionId!==intent.actionId||
  receipt.submittedUrl!==intent.submittedUrl||
  !['matched','needs_evidence','conflict'].includes(receipt.status)||
  typeof receipt.verifiedIdentity!=='boolean'||typeof receipt.joined!=='boolean')
  throw new Error('Unverified or cross-account EventHub URL result.');
 if(receipt.status==='matched'){
  if(!receipt.verifiedIdentity||!valid(receipt.eventId)||!valid(receipt.groupId)||receipt.joined)
   throw new Error('EventHub match lacks exact owner-certified event and group.');
 }else if(receipt.eventId!==null||receipt.groupId!==null||
           receipt.verifiedIdentity||receipt.joined){
  throw new Error('Unresolved EventHub URL cannot grant a group identity.');
 }
 // A matched URL is still never permission to claim registration/attendance.
 return receipt;
}
