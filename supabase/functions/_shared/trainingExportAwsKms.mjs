/**
 * ALL-251 server-only AWS KMS envelope-key adapter for the EXISTING
 * createAccountExportKeyLease({unwrapDataKey}) boundary.
 *
 * Caller constructs a genuine AWS SDK v3 KMSClient and passes the SDK's
 * GenerateDataKeyCommand/DecryptCommand constructors. No credentials, static
 * keys, HTTP exposure, new database, or KMS resource is created here.
 * Never put owner IDs or other sensitive values in log statements; KMS
 * encryption context is recorded in AWS CloudTrail as plaintext.
 */
import {createHash} from 'node:crypto';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY_ARN=/^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key\/[0-9a-f-]{36}$/i;
const VERSION=1;
const PURPOSE='account-export-v2';
function validIdentity({ownerId,requestId},keyVersion,purpose){
 if(!UUID.test(ownerId??'')||!UUID.test(requestId??'')
  ||keyVersion!==VERSION||purpose!==PURPOSE)
  throw Error('Unapproved export encryption context');
 // KMS encryption context is visible in CloudTrail. Bind exact identities
 // via a domain-separated digest rather than emitting user UUIDs in logs.
 const bound=createHash('sha256').update(['all251-kms-context-v1',ownerId,requestId].join(':')).digest('hex');
 return Object.freeze({purpose:PURPOSE,scopeDigest:bound,keyVersion:String(VERSION)});
}
function checkedBytes(x){
 if(!(x instanceof Uint8Array)||x.byteLength!==32)
  throw Error('KMS returned invalid AES-256 key');
 return new Uint8Array(x);
}
function parseWrapped(encoded){
 if(typeof encoded!=='string'||encoded.length<32||encoded.length>8192
  ||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)||encoded.length%4!==0)
  throw Error('Invalid KMS ciphertext encoding');
 const bytes=Uint8Array.from(Buffer.from(encoded,'base64'));
 if(!bytes.length||Buffer.from(bytes).toString('base64')!==encoded)
  throw Error('Invalid canonical KMS ciphertext');
 return bytes;
}
export function createAwsKmsExportKeyProvider({
 client,GenerateDataKeyCommand,DecryptCommand,keyArn,
}={}){
 if(typeof client?.send!=='function'
   ||typeof GenerateDataKeyCommand!=='function'
   ||typeof DecryptCommand!=='function'
   ||typeof keyArn!=='string'||!KEY_ARN.test(keyArn))
  throw Error('Trusted AWS KMS client, commands and exact key ARN required');
 return Object.freeze({
  async generateDataKey({ownerId,requestId,keyVersion=VERSION,purpose=PURPOSE}){
   const context=validIdentity({ownerId,requestId},keyVersion,purpose);
   const result=await client.send(new GenerateDataKeyCommand({
    KeyId:keyArn,KeySpec:'AES_256',EncryptionContext:context,
   }));
   if(result?.KeyId!==keyArn
     ||!(result?.CiphertextBlob instanceof Uint8Array)
     ||result.CiphertextBlob.byteLength<24||result.CiphertextBlob.byteLength>6144)
     throw Error('KMS key identity or ciphertext invalid');
   const key=checkedBytes(result.Plaintext);
   return {kmsKeyId:keyArn,keyVersion:VERSION,keyPurpose:PURPOSE,
    wrappedDataKey:Buffer.from(result.CiphertextBlob).toString('base64'),
    encryptionKey:key};
  },
  async unwrapDataKey({kmsKeyId,wrappedDataKey,keyVersion,purpose,context}){
   if(kmsKeyId!==keyArn)throw Error('Unapproved KMS key');
   const encryptionContext=validIdentity(context??{},keyVersion,purpose);
   const blob=parseWrapped(wrappedDataKey);
   const result=await client.send(new DecryptCommand({
    KeyId:keyArn,CiphertextBlob:blob,
    EncryptionContext:encryptionContext,
   }));
   if(result?.KeyId!==keyArn)throw Error('KMS decrypted with unexpected key');
   return checkedBytes(result.Plaintext);
  },
 });
}
