/** ALL-243 review-only dedicated registrar database adapter.
 * This is not a public SQL RPC or source-attestation verifier. The caller
 * must validate Auth.getUser and trusted native/provider HMAC proof first.
 */
import type {PairingBackend,PairingTransaction,PairingSession}
 from './certifiedDevicePairingServer.ts';
import type {TransactionalSql} from './certifiedDevicePostgresAdapter.ts';
const uuid=(v:unknown)=>typeof v==='string'&&
 /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const validTime=(v:number)=>Number.isSafeInteger(v)&&v>0;
export function createDevicePairingPostgresBackend(deps:{
 db:TransactionalSql;
 auth:{getUser:(token:string)=>Promise<{id:string}|null>};
 readVerifiedTokenClaims:(token:string)=>{sessionId:string;expiresAtMs:number}|null;
 nowMs:()=>number;
}):PairingBackend{
 return {
  async resolveUser(token){
   const verified=await deps.auth.getUser(token);
   const claims=verified?deps.readVerifiedTokenClaims(token):null;
   if(!verified||!uuid(verified.id)||!claims||!uuid(claims.sessionId)||
    !validTime(claims.expiresAtMs)||claims.expiresAtMs<=deps.nowMs())return null;
   return {ownerId:verified.id,sessionId:claims.sessionId,
    expiresAtMs:claims.expiresAtMs} satisfies PairingSession;
  },
  async withOwnerTransaction<T>(ownerId:string,work:(tx:PairingTransaction)=>Promise<T>){
   if(!uuid(ownerId))throw Error('Verified pairing owner required');
   return deps.db.begin(async sql=>{
    const role=await sql.unsafe(`
SELECT current_user AS name,rolsuper,rolbypassrls
FROM pg_catalog.pg_roles WHERE rolname=current_user`);
    if(role.length!==1||role[0].name!=='allin_v2_device_registrar'||
      role[0].rolsuper!==false||role[0].rolbypassrls!==false)
     throw Error('Trusted least-privilege pairing registrar required');
    await sql.unsafe("SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
    const sessionOk=async(sessionId:string)=>{
     if(!uuid(sessionId))return false;
     const rows=await sql.unsafe(`
SELECT 1 AS valid FROM auth.sessions
 WHERE id=$1::uuid AND user_id=$2::uuid
   AND (not_after IS NULL OR not_after>pg_catalog.now())`,[sessionId,ownerId]);
     return rows.length===1;
    };
    const tx:PairingTransaction={
     issueChallenge:async args=>{
      if(args.ownerId!==ownerId||!await sessionOk(args.sessionId)||
        !uuid(args.challengeId)||!validTime(args.expiresAtMs))return false;
      const rows=await sql.unsafe(`
INSERT INTO allin_private.v2_device_pairing_challenges_candidate
(id,owner_id,session_id,device_ref,provider,expires_at)
VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,
 to_timestamp($6::double precision/1000))
RETURNING id`,[args.challengeId,ownerId,args.sessionId,
       args.deviceRef,args.provider,args.expiresAtMs]);
      return rows.length===1;
     },
     registerProof:async args=>{
      if(args.ownerId!==ownerId||!await sessionOk(args.sessionId)||
       !uuid(args.challengeId)||!uuid(args.deviceId)||!uuid(args.auditId))
       throw Error('Trusted pairing authorization denied');
      const rows=await sql.unsafe(`
SELECT allin_private.v2_device_pair_verified_candidate(
 $1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6,$7,$8,$9::uuid) AS status`,[
       args.challengeId,args.deviceId,ownerId,args.sessionId,args.deviceRef,
       args.provider,args.attestationKind,args.evidenceHash,args.auditId]);
      if(rows[0]?.status!=='paired')throw Error('Verified device registration failed');
      return 'paired';
     },
     revokeDevice:async args=>{
      if(args.ownerId!==ownerId||!await sessionOk(args.sessionId)||
       !uuid(args.deviceId)||!uuid(args.auditId))
       throw Error('Trusted revocation authorization denied');
      const rows=await sql.unsafe(`
SELECT allin_private.v2_device_revoke_candidate(
 $1::uuid,$2::uuid,$3::uuid,$4::uuid) AS status`,[
       args.deviceId,ownerId,args.sessionId,args.auditId]);
      const status=rows[0]?.status;
      if(status!=='revoked'&&status!=='already_revoked')
       throw Error('Device revocation failed');
      return status;
     },
    };
    return work(tx);
   });
  },
 };
}
