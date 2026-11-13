/**
 * ALL-251: explicit, operator-run AWS KMS acceptance against an EXISTING key.
 * NO resource provisioning, key creation, user data, DB access, deployment,
 * deletion, archive export activation or logs of user IDs or ciphertext.
 *
 * Run only in a protected, ephemeral runner with pre-existing AWS role
 * credentials, AWS SDK v3 dependencies and explicit founder cost approval.
 * Never invoke this script in ordinary CI or on a shared developer account.
 */
import assert from 'node:assert/strict';
import {randomUUID,timingSafeEqual} from 'node:crypto';
import {createAwsKmsExportKeyProvider} from
 '../supabase/functions/_shared/trainingExportAwsKms.mjs';

const vars=process.env;
function required(name){const value=vars[name];if(!value)throw Error('Missing protected input: '+name);return value;}
if(vars.ALL251_KMS_HOSTED_ALLOW!=='true'
 || vars.ALL251_KMS_COST_APPROVED!=='true'
 || vars.ALL251_KMS_SYNTHETIC_ONLY!=='true')
 throw Error('Actual AWS KMS acceptance requires explicit operator and cost approval');
const arn=required('ALL251_KMS_KEY_ARN');
const region=required('ALL251_KMS_REGION');
const expectedAccount=required('ALL251_KMS_EXPECTED_ACCOUNT');
if(!/^arn:aws:kms:([a-z0-9-]+):([0-9]{12}):key\/[0-9a-f-]{36}$/i.test(arn)
 || arn.split(':')[3]!==region
 || arn.split(':')[4]!==expectedAccount
 || !/^[0-9]{12}$/.test(expectedAccount))
 throw Error('Existing exact KMS account/region/key ARN required');

let kms,sts,generated;
try{
 const [
  {KMSClient,DescribeKeyCommand,GenerateDataKeyCommand,DecryptCommand},
  {STSClient,GetCallerIdentityCommand}
 ]=await Promise.all([import('@aws-sdk/client-kms'),import('@aws-sdk/client-sts')]);
 const sdkConfig={region,maxAttempts:2};
 kms=new KMSClient(sdkConfig); sts=new STSClient(sdkConfig);
 const identity=await sts.send(new GetCallerIdentityCommand({}));
 assert.equal(identity.Account,expectedAccount,'AWS credential account mismatch');
 assert(typeof identity.Arn==='string' && /:assumed-role\//.test(identity.Arn),
  'Protected temporary role credentials required, not an IAM user or root');
 const descriptor=await kms.send(new DescribeKeyCommand({KeyId:arn}));
 const meta=descriptor.KeyMetadata;
 assert.equal(meta?.Arn,arn,'KMS key ARN mismatch');
 assert.equal(meta?.KeyState,'Enabled','KMS key not enabled');
 assert.equal(meta?.KeySpec,'SYMMETRIC_DEFAULT','KMS key not symmetric');
 assert.equal(meta?.KeyUsage,'ENCRYPT_DECRYPT','KMS key not encryption-capable');
 const provider=createAwsKmsExportKeyProvider({
  client:kms,GenerateDataKeyCommand,DecryptCommand,keyArn:arn
 });
 const a=randomUUID(),b=randomUUID(),request=randomUUID(),otherRequest=randomUUID();
 generated=await provider.generateDataKey({ownerId:a,requestId:request});
 assert(generated.encryptionKey instanceof Uint8Array);
 assert.equal(generated.encryptionKey.byteLength,32);
 const scope={kmsKeyId:arn,wrappedDataKey:generated.wrappedDataKey,
  keyVersion:1,purpose:'account-export-v2'};
 const plain=await provider.unwrapDataKey({...scope,context:{ownerId:a,requestId:request}});
 assert(timingSafeEqual(plain,generated.encryptionKey),'Hosted KMS unwrap mismatch');
 plain.fill(0);
 // A second owner/request must fail inside KMS authenticated encryption,
 // not merely be rejected by our own caller-side identity comparison.
 for(const context of [{ownerId:b,requestId:request},
                       {ownerId:a,requestId:otherRequest}]){
  let denied=false;
  try{const wrong=await provider.unwrapDataKey({...scope,context});
   wrong.fill(0);
  }catch{denied=true}
  assert(denied,'KMS decrypted for a different synthetic owner/request');
 }
 assert.equal(generated.keyPurpose,'account-export-v2');
 console.log('PASS ALL-251 HOSTED KMS: exact pre-existing role/account/key, AES-256, scoped roundtrip, both cross-context denies');
 console.log('LIMIT: not archive worker or mobile acceptance; review IAM/CloudTrail and key cleanup separately');
}catch{
 // Never print network exception details, command input, AWS identity, keys,
 // secrets, context digests or ciphertext in a shared CI console.
 console.error('FAIL ALL-251 hosted KMS provider acceptance; inspect protected operator diagnostics');
 process.exitCode=1;
}finally{
 if(generated?.encryptionKey instanceof Uint8Array)generated.encryptionKey.fill(0);
 await Promise.allSettled([kms?.destroy(),sts?.destroy()]);
}
