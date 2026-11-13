#!/usr/bin/env node
// ALL-210 / ALL-217: real JWT Coach HTTP acceptance in disposable staging ONLY.
// Requires the staging SECRET key and PUBLISHABLE key (legacy variable names kept for compatibility).
// Modern sb_secret/sb_publishable keys go only in the apikey header; user JWTs in Authorization.
// Never paste tokens or keys in chat or add them to Git.
import assert from "node:assert/strict";
import {randomBytes,randomUUID} from "node:crypto";
const project="fbtgknlxjyeqrxemskbl";
const base="https://"+project+".supabase.co";
const serviceKey=process.env.ALL217_STAGING_SERVICE_ROLE_KEY;
const anonKey=process.env.ALL217_STAGING_ANON_KEY;
const valid=x=>typeof x==="string"&&x.length>=20&&x.trim()===x;
if(!valid(serviceKey)||!valid(anonKey)||serviceKey===anonKey||
 (process.env.ALL217_STAGING_PROJECT_ID&&process.env.ALL217_STAGING_PROJECT_ID!==project)){
 console.error("BLOCKED: distinct staging Auth Admin and anon keys required.");
 process.exitCode=2;
}else{
 const created=[],checks=[];
 const http=async(path,{method="POST",body,token,admin=false}={})=>{
  const key=admin?serviceKey:anonKey;
  const result=await fetch(base+path,{
   method,signal:AbortSignal.timeout(15000),
   headers:{apikey:key,...(token?{authorization:"Bearer "+token}:{}),
    "content-type":"application/json","cache-control":"no-store"},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  let data=null;try{data=await result.json()}catch{}
  return {status:result.status,data};
 };
 const check=(label,ok)=>{
  assert.ok(ok,label);checks.push(label);console.log("PASS "+label);
 };
 const create=async(label)=>{
  const email="all217-"+label+"-"+randomUUID()+"@example.invalid";
  const password=randomBytes(36).toString("base64url")+"!1aA";
  const user=await http("/auth/v1/admin/users",{admin:true,
   body:{email,password,email_confirm:true,
    app_metadata:{all217_temporary_staging:true}}});
  assert.equal(user.status,200,"Auth Admin creation HTTP "+user.status);
  assert.ok(user.data?.id,"Auth user ID missing");
  created.push(user.data.id);
  const session=await http("/auth/v1/token?grant_type=password",{
   body:{email,password}
  });
  assert.equal(session.status,200,"sign-in HTTP "+session.status);
  assert.equal(session.data?.user?.id,user.data.id,"signed-in owner mismatch");
  assert.ok(session.data?.access_token&&session.data?.refresh_token);
  return {id:user.data.id,access:session.data.access_token,refresh:session.data.refresh_token,email,password};
 };
 const coach=(token,body)=>http("/functions/v1/v2-coach",{token,body});
 let failed=false;
 try{
  const a=await create("a"),b=await create("b");
  check("two genuine independent Auth sessions",a.id!==b.id);
  const bad=await coach("invalid.jwt.signature",{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("invalid JWT denied",bad.status===401||bad.status===403);
  const first=await coach(a.access,{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("A opens canonical thread",first.status===200&&
   first.data?.status==="ok"&&typeof first.data.threadId==="string");
  const thread=first.data.threadId;
  const again=await coach(a.access,{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("A reopens same canonical thread",again.status===200&&again.data?.threadId===thread);
  const second=await coach(b.access,{
   action:"open",ownerId:b.id,candidateThreadId:randomUUID()
  });
  check("B opens different canonical thread",second.status===200&&
   second.data?.threadId&&second.data.threadId!==thread);
  const history=await coach(a.access,{
   action:"history",ownerId:a.id,threadId:thread,limit:10
  });
  check("A reads own empty history",history.status===200&&
   Array.isArray(history.data?.messages)&&history.data.messages.length===0);
  const stolen=await coach(b.access,{
   action:"history",ownerId:b.id,threadId:thread,limit:10
  });
  check("B cannot read A history",[401,403,503].includes(stolen.status));
  const spoof=await coach(b.access,{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("B cannot impersonate A",[401,403].includes(spoof.status));
  const refresh=await http("/auth/v1/token?grant_type=refresh_token",{
   body:{refresh_token:a.refresh}
  });
  check("A refreshes Auth session",refresh.status===200&&!!refresh.data?.access_token);
  const resumed=await coach(refresh.data.access_token,{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("refreshed session resumes thread",resumed.status===200&&resumed.data?.threadId===thread);
  // Separate GoTrue password login simulates a fresh client session.
  // No prior client token or locally cached thread ID is passed to open.
  const independent=await http("/auth/v1/token?grant_type=password",{
   body:{email:a.email,password:a.password}
  });
  check("independent second client authenticates same owner",
   independent.status===200&&independent.data?.user?.id===a.id&&
   independent.data?.access_token!==a.access);
  const secondDevice=await coach(independent.data.access_token,{
   action:"open",ownerId:a.id,candidateThreadId:randomUUID()
  });
  check("fresh second client resumes server-owned thread",
   secondDevice.status===200&&secondDevice.data?.threadId===thread);
  const secondHistory=await coach(independent.data.access_token,{
   action:"history",ownerId:a.id,threadId:thread,limit:10
  });
  check("independent client reads owner-scoped history",
   secondHistory.status===200&&Array.isArray(secondHistory.data?.messages)&&
   secondHistory.data.messages.length===0);
  const denied=await coach(refresh.data.access_token,{
   action:"send",ownerId:a.id,threadId:thread,clientRequestId:randomUUID(),
   userMessageId:randomUUID(),assistantMessageId:randomUUID(),
   message:"Staging test only"
  });
  check("paid send blocked",denied.status===503);
  const finalHistory=await coach(refresh.data.access_token,{
   action:"history",ownerId:a.id,threadId:thread,limit:10
  });
  check("blocked send saved nothing",finalHistory.status===200&&
   finalHistory.data?.messages?.length===0);
  console.log("PASS Hosted Coach acceptance: "+checks.length+" checks");
 }catch(error){
  failed=true;console.error("FAIL: "+(error?.message??"unknown hosted acceptance error"));
 }finally{
  for(const id of created.reverse()){
   try{
    const r=await http("/auth/v1/admin/users/"+encodeURIComponent(id),{
     method:"DELETE",admin:true
    });
    if(![200,204].includes(r.status)){
     failed=true;console.error("CLEANUP FAILED: Auth delete HTTP "+r.status);
    }else console.log("PASS disposable user deleted");
   }catch{
    failed=true;console.error("CLEANUP FAILED: Auth delete request");
   }
  }
  if(failed)process.exitCode=1;
 }
}
