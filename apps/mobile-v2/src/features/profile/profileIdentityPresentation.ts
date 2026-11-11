/** ALL-251: Profile identity presentation only.
 * Never infer a public handle or expose account email as a public identity.
 * An initial is a placeholder until private avatar storage is implemented.
 */
export function profileIdentityDisplay(displayName:string|null|undefined):string{
 const s=typeof displayName==='string'?displayName.trim().replace(/\s+/g,' '):'';
 return s||'Your Profile';
}
export function profileAvatarInitials(displayName:string|null|undefined):string{
 const cleaned=typeof displayName==='string'?displayName.trim().replace(/\s+/g,' '):'';
 if(!cleaned)return 'A';
 const words=cleaned.split(' ').filter(Boolean);
 const take=(value:string)=>Array.from(value)[0]?.toUpperCase()??'';
 const a=take(words[0]),b=words.length>1?take(words[words.length-1]):'';
 return (a+b).slice(0,2)||'A';
}
