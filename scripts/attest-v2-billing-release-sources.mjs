// ALL-222 / ALL-266 — read-only source attestation for the billing migration.
// Produces an exact SHA-256 review manifest; never writes migration files,
// connects to Supabase, deploys a function, or enables payments.
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';

export const sources=Object.freeze([
 'docs/architecture/sql/V2-SUBSCRIPTION-VERIFIED-LEDGER-CANDIDATE.sql',
 'docs/architecture/sql/V2-SUBSCRIPTION-SERVICE-GRANTS-CANDIDATE.sql',
]);
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const allowedGrant=/^grant\s+(?:select|insert|update|delete|usage|execute)(?:\s*,\s*(?:select|insert|update|delete|usage|execute))*\s+on\s+(?:table|sequence|function)\s+[\s\S]+?\s+to\s+service_role\s*$/i;
export function attestBillingCandidate(ledger,grants){
 const problems=[];
 if(!/create\s+table\s+allin_private\.v2_subscription_checkout_attempts\s*\(/i.test(ledger)||
    !/create\s+table\s+allin_private\.v2_subscription_purchases\s*\(/i.test(ledger)||
    !/create\s+table\s+allin_private\.v2_subscription_verified_events\s*\(/i.test(ledger))
   problems.push('Missing one or more canonical owner-bound billing tables');
 if(!/enable\s+row\s+level\s+security/i.test(ledger)||
    !/security\s+invoker\s+set\s+search_path\s*=\s*''/i.test(ledger))
   problems.push('Billing RLS or pinned invoker catalog missing');
 if(!/REVIEW ONLY/i.test(grants)||!/NOT A VERSIONED MIGRATION/i.test(grants))
   problems.push('Service grants are no longer review-only');
 // Strip only whole-line SQL comments, so quoted comments never become
 // instructions in this scanner. No dynamic SQL or grants to client roles.
 const statements=grants.replace(/^\s*--[^\n]*$/gm,'')
   .split(';').map(v=>v.trim()).filter(Boolean);
 if(statements.length<20)problems.push('Reviewed service-role allowlist unexpectedly shrank');
 for(const statement of statements){
   if(!allowedGrant.test(statement))problems.push('Unreviewed grant statement: '+statement.slice(0,80));
 }
 if(/\b(?:grant\s+all|to\s+(?:anon|authenticated|public)|security\s+definer)\b/i.test(grants))
   problems.push('Disallowed client grant, broad grant or definer in service allowlist');
 if(/\b(?:drop\s+(?:schema|table)|truncate\s+table|alter\s+role|create\s+role)\b/i.test(ledger+grants))
   problems.push('Destructive or role-changing statement in proposed billing sources');
 const combined=ledger+'\n-- ALL-222: canonical service-only grants follow the ledger objects\n'+grants;
 return Object.freeze({
   ok:problems.length===0,problems,
   ledgerSha256:sha(ledger),grantsSha256:sha(grants),
   combinedSha256:sha(combined),
   grantCount:statements.length,
   sourceOrder:sources,
 });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
 const [ledger,grants]=sources.map(path=>readFileSync(resolve(root,path),'utf8'));
 const report=attestBillingCandidate(ledger,grants);
 console.log(JSON.stringify(report,null,2));
 if(!report.ok)process.exitCode=1;
}
