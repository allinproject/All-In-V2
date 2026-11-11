/**
 * ALL-252: Stripe webhook signature gate for a future sandbox-only endpoint.
 * Pure WebCrypto implementation. Verify the exact raw HTTP bytes BEFORE JSON
 * parsing. Never use webhook event metadata to bind a purchase to an owner;
 * retrieve the current Stripe subscription through merchant-scoped secret API
 * and then use the existing private transactional purchase writer.
 */
const enc=new TextEncoder();
const id=(x,p)=>typeof x==='string'&&x.startsWith(p)&&x.length<=256&&
  /^[a-zA-Z0-9_]+$/.test(x);
const safeHex=x=>typeof x==='string'&&/^[a-fA-F0-9]{64}$/.test(x);
const eventTypes=new Set([
  'checkout.session.completed','checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed','customer.subscription.created',
  'customer.subscription.updated','customer.subscription.deleted',
  'invoice.paid','invoice.payment_failed',
]);
const constantTimeEqual=(a,b)=>{
  if(a.length!==b.length)return false;
  let difference=0;
  for(let i=0;i<a.length;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);
  return difference===0;
};
export async function verifyStripeSandboxWebhook({
  rawBody,signatureHeader,webhookSecrets,nowSeconds,
}={}){
  if(!(rawBody instanceof Uint8Array)||rawBody.byteLength===0||
      rawBody.byteLength>256*1024||
      typeof signatureHeader!=='string'||signatureHeader.length>2048||
      !Array.isArray(webhookSecrets)||webhookSecrets.length<1||
      webhookSecrets.length>3||webhookSecrets.some(s=>
        typeof s!=='string'||!/^whsec_[A-Za-z0-9]+$/.test(s))||
      !Number.isSafeInteger(nowSeconds)||nowSeconds<0)
    return {status:'invalid_envelope'};
  let timestamp=null,signatures=[];
  for(const part of signatureHeader.split(',')){
    const item=part.trim(),index=item.indexOf('=');
    if(index<1)continue;
    const key=item.slice(0,index),value=item.slice(index+1);
    if(key==='t'){
      if(timestamp!==null||!/^[0-9]{1,12}$/.test(value))
        return {status:'invalid_signature'};
      timestamp=Number(value);
    }else if(key==='v1'){
      if(!safeHex(value))return {status:'invalid_signature'};
      signatures.push(value.toLowerCase());
    }
  }
  if(!Number.isSafeInteger(timestamp)||signatures.length===0||
      signatures.length>8||Math.abs(nowSeconds-timestamp)>300)
    return {status:'invalid_signature'};
  const signed=new Uint8Array(enc.encode(String(timestamp)+'.').length+
                             rawBody.byteLength);
  signed.set(enc.encode(String(timestamp)+'.'));
  signed.set(rawBody,enc.encode(String(timestamp)+'.').length);
  let valid=false;
  try{
    for(const secret of webhookSecrets){
      const key=await crypto.subtle.importKey('raw',enc.encode(secret),
        {name:'HMAC',hash:'SHA-256'},false,['sign']);
      const signature=new Uint8Array(await crypto.subtle.sign('HMAC',key,signed));
      const hex=Array.from(signature,x=>x.toString(16).padStart(2,'0')).join('');
      for(const candidate of signatures)
        valid=constantTimeEqual(hex,candidate)||valid;
    }
  }catch{return {status:'invalid_signature'}}
  if(!valid)return {status:'invalid_signature'};
  let event;
  try{event=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rawBody))}
  catch{return {status:'invalid_event'}};
  if(!event||event.object!=='event'||!id(event.id,'evt_')||
     event.livemode!==false||!Number.isSafeInteger(event.created)||
     typeof event.type!=='string')
    return {status:'invalid_event'};
  if(!eventTypes.has(event.type))return {status:'ignored_event'};
  // The event is a verified notification only, NOT authoritative subscription
  // state and not a client entitlement or account-owner identity.
  const target=event.data?.object;
  if(!target||typeof target!=='object'||!id(target.id,
      event.type.startsWith('checkout.')?'cs_':
      event.type.startsWith('customer.subscription.')?'sub_':'in_'))
    return {status:'invalid_event'};
  return {status:'verified_notification',eventId:event.id,
    eventType:event.type,objectId:target.id};
}
