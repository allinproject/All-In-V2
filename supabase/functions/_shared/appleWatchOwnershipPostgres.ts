/** ALL-243 stage-only PostgreSQL evidence reader: no client grants.
 * Builds atop existing registrar and existing trusted Auth resolver.
 * Trust anchor for iPhone app key MUST be independently Apple-attested;
 * this adapter has no path to enroll a phone key.
 */
import type {TransactionalSql} from './certifiedDevicePostgresAdapter.ts';
import type {PairingBackend} from './certifiedDevicePairingServer.ts';
import type {AppleWatchVerifiedBackend,AppleWatchEvidenceStore}
 from './appleWatchOwnershipVerifier.ts';
const uuid=(s:unknown):s is string=>typeof s==='string'&&
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export function createAppleWatchOwnershipPostgresBackend(
 base:PairingBackend,db:TransactionalSql):AppleWatchVerifiedBackend{
 return {
  ...base,
  async withEvidenceTransaction<T>(
   ownerId:string,work:(store:AppleWatchEvidenceStore)=>Promise<T>,
  ){
   if(!uuid(ownerId))throw Error('Verified athlete owner required');
   return db.begin(async sql=>{
    const role=await sql.unsafe(`
SELECT current_user AS name,rolsuper,rolbypassrls
 FROM pg_catalog.pg_roles WHERE rolname=current_user`);
    if(role.length!==1||role[0].name!=='allin_v2_device_registrar'||
      role[0].rolsuper!==false||role[0].rolbypassrls!==false)
     throw Error('Dedicated registrar required for Apple Watch proof');
    await sql.unsafe(
     "SELECT pg_catalog.set_config('request.jwt.claim.sub',$1,true)",[ownerId]);
    // Lock ordering matches existing owner metric ingestion/revoke writer;
    // a revoked challenge or key must not produce a paired device.
    await sql.unsafe(`
SELECT pg_catalog.pg_advisory_xact_lock(
 pg_catalog.hashtextextended('v2-metric:'||$1,0))`,[ownerId]);
    const store:AppleWatchEvidenceStore={
     async getChallenge(input){
      if(input.ownerId!==ownerId||!uuid(input.sessionId)||
       !uuid(input.challengeId))return null;
      const rows=await sql.unsafe(`
SELECT c.id,c.owner_id,c.session_id,c.device_ref,c.provider,
 extract(epoch FROM c.expires_at)*1000 AS expires_ms,
 extract(epoch FROM c.consumed_at)*1000 AS consumed_ms
FROM allin_private.v2_device_pairing_challenges_candidate c
JOIN auth.sessions s ON s.id=c.session_id AND s.user_id=c.owner_id
WHERE c.id=$1::uuid AND c.owner_id=$2::uuid AND c.session_id=$3::uuid
 AND (s.not_after IS NULL OR s.not_after>pg_catalog.now())
 AND c.consumed_at IS NULL AND c.expires_at>pg_catalog.now()`,[
       input.challengeId,ownerId,input.sessionId]);
      const r=rows[0];return r?{
       challengeId:String(r.id),ownerId:String(r.owner_id),
       sessionId:String(r.session_id),deviceRef:String(r.device_ref),
       provider:r.provider as 'apple_watch',
       expiresAtMs:Number(r.expires_ms),
       consumedAtMs:r.consumed_ms===null?null:Number(r.consumed_ms),
      }:null;
     },
     async getAppleAttestedPhoneKey(input){
      if(input.ownerId!==ownerId||!input.keyId)return null;
      const rows=await sql.unsafe(`
SELECT key_id,owner_id,apple_app_id,public_key_spki_base64url,
 assertion_sign_count,extract(epoch FROM apple_attestation_verified_at)*1000 AS verified_ms,
 extract(epoch FROM revoked_at)*1000 AS revoked_ms
FROM allin_private.v2_apple_attested_companion_keys_candidate
WHERE key_id=$1 AND owner_id=$2::uuid AND revoked_at IS NULL`,[
       input.keyId,ownerId]);
      const r=rows[0];return r?{
       keyId:String(r.key_id),ownerId:String(r.owner_id),appId:String(r.apple_app_id),
       publicKeySpkiB64url:String(r.public_key_spki_base64url),
       signCount:Number(r.assertion_sign_count),
       appleAttestationVerifiedAtMs:Number(r.verified_ms),
       revokedAtMs:r.revoked_ms===null?null:Number(r.revoked_ms),
      }:null;
     },
     async advancePhoneCounter(input){
      if(input.ownerId!==ownerId||!input.keyId||
       !Number.isSafeInteger(input.previousCount)||
       !Number.isSafeInteger(input.newCount)||
       input.newCount<=input.previousCount)return false;
      const rows=await sql.unsafe(`
UPDATE allin_private.v2_apple_attested_companion_keys_candidate
 SET assertion_sign_count=$3::bigint
WHERE key_id=$1 AND owner_id=$2::uuid
 AND assertion_sign_count=$4::bigint
 AND assertion_sign_count<$3::bigint
 AND revoked_at IS NULL
RETURNING key_id`,[input.keyId,ownerId,input.newCount,input.previousCount]);
      return rows.length===1;
     },
    };
    return work(store);
   });
  },
 };
}
