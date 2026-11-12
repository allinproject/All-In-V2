/** ALL-243 staged trusted Apple App Attest enrollment DB adapter.
 * Not an endpoint and not usable with service_role/client credentials.
 * Requires independent Apple signed-receipt validation in server coordinator.
 */
import type {TransactionalSql} from './certifiedDevicePostgresAdapter.ts';
import type {AppAttestEnrollmentBackend,AppAttestEnrollmentTransaction}
 from './appleAppAttestEnrollmentServer.ts';
const uuid=(s:unknown)=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function createAppleAppAttestEnrollmentPostgres(deps:{
 db:TransactionalSql;
 auth:{getUser:(token:string)=>Promise<{id:string}|null>};
 readVerifiedTokenClaims:(token:string)=>{sessionId:string;expiresAtMs:number}|null;
 nowMs:()=>number;
}):AppAttestEnrollmentBackend{
 return {
  async resolveUser(token){
   const user=await deps.auth.getUser(token);
   const claims=user?deps.readVerifiedTokenClaims(token):null;
   if(!user||!uuid(user.id)||!claims||!uuid(claims.sessionId)||
    !Number.isSafeInteger(claims.expiresAtMs)||
    claims.expiresAtMs<=deps.nowMs())return null;
   return {ownerId:user.id,sessionId:claims.sessionId,
    expiresAtMs:claims.expiresAtMs};
  },
  async withOwnerTransaction<T>(
   ownerId:string,fn:(tx:AppAttestEnrollmentTransaction)=>Promise<T>,
  ){
   if(!uuid(ownerId))throw Error('Verified owner required');
   return deps.db.begin(async db=>{
    const roles=await db.unsafe(`
SELECT current_user AS name,rolsuper,rolbypassrls,
 pg_catalog.pg_has_role(current_user,'allin_v2_appattest_enroller','SET') AS permitted
FROM pg_catalog.pg_roles WHERE rolname=current_user`);
    const role=roles[0];
    if(roles.length!==1||role.rolsuper!==false||
     role.rolbypassrls!==false||role.permitted!==true||
     role.name!=='allin_v2_appattest_enrollment_operator')
     throw Error('Dedicated Apple attestation enrollment operator required');
    await db.unsafe('SET LOCAL ROLE allin_v2_appattest_enroller');
    await db.unsafe(
     "SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
    // Never trust the request's session claim without this live database row.
    const sessionOk=async(sessionId:string)=>{
     if(!uuid(sessionId))return false;
     const rows=await db.unsafe(`
SELECT 1 AS valid FROM auth.sessions s
JOIN auth.users u ON u.id=s.user_id
WHERE s.id=$1::uuid AND s.user_id=$2::uuid
 AND (s.not_after IS NULL OR s.not_after>pg_catalog.now())`,[sessionId,ownerId]);
     return rows.length===1;
    };
    const tx:AppAttestEnrollmentTransaction={
     issueChallenge:async p=>{
      if(p.ownerId!==ownerId||!uuid(p.challengeId)||
       !await sessionOk(p.sessionId)||
       !Number.isSafeInteger(p.expiresAtMs)||
       p.expiresAtMs<=deps.nowMs()||
       p.expiresAtMs>deps.nowMs()+300000)
       throw Error('App Attest challenge issue denied');
      await db.unsafe(`
INSERT INTO allin_private.v2_appattest_enrollment_challenges_candidate
 (id,owner_id,session_id,apple_app_id,environment,expires_at)
VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,
 to_timestamp($6::double precision/1000))`,[
       p.challengeId,ownerId,p.sessionId,p.appId,p.environment,
       p.expiresAtMs,
      ]);
     },
     getActiveChallenge:async p=>{
      if(p.ownerId!==ownerId||!await sessionOk(p.sessionId)||!uuid(p.challengeId))
       return null;
      const rows=await db.unsafe(`
SELECT id,owner_id,session_id,apple_app_id,environment,
 extract(epoch FROM expires_at)*1000 AS expires_ms,
 extract(epoch FROM consumed_at)*1000 AS consumed_ms
FROM allin_private.v2_appattest_enrollment_challenges_candidate
WHERE id=$1::uuid AND owner_id=$2::uuid AND session_id=$3::uuid
 AND consumed_at IS NULL AND expires_at>pg_catalog.now()`,[
       p.challengeId,ownerId,p.sessionId,
      ]);
      const r=rows[0];return r?{
       challengeId:String(r.id),ownerId:String(r.owner_id),
       sessionId:String(r.session_id),appId:String(r.apple_app_id),
       environment:r.environment as 'sandbox'|'production',
       expiresAtMs:Number(r.expires_ms),
       consumedAtMs:r.consumed_ms===null?null:Number(r.consumed_ms),
      }:null;
     },
     insertVerifiedKey:async p=>{
      if(p.ownerId!==ownerId||!await sessionOk(p.sessionId)||
       !uuid(p.challengeId))throw Error('Verified enrollment session changed');
      const rows=await db.unsafe(`
SELECT allin_private.v2_appattest_enroll_verified_key_candidate(
 $1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9) AS result`,[
       p.challengeId,ownerId,p.sessionId,p.keyId,p.appId,p.environment,
       p.publicKeySpkiBase64url,p.receiptHash,p.leafHash,
      ]);
      if(rows[0]?.result!=='enrolled')
       throw Error('Private App Attest enrollment writer declined');
      return 'enrolled';
     },
    };
    return fn(tx);
   });
  },
 };
}
