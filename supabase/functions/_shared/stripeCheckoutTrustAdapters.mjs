/**
 * ALL-252 — service-only trust adapters to the existing V2 Auth and private
 * subscription checkout claim. No network, credentials or deployed route.
 *
 * authGetUser(token): trusted Supabase auth.getUser(token) response.
 * claimPrivateTrial(args): trusted DB service-role function result; caller must
 * call ONLY allin_private.v2_claim_trial_checkout_attempt. Neither the mobile
 * client nor user-editable JWT metadata may supply owner or eligibility.
 */
const uuid=value=>typeof value==='string'&&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);

export function createCheckoutTrustAdapters({authGetUser,claimPrivateTrial,claimPrivatePaid}={}){
  if(typeof authGetUser!=='function'||typeof claimPrivateTrial!=='function')
    return null;
  return Object.freeze({
    async authenticateBearer(token){
      if(typeof token!=='string'||token.length<4||token.length>4096)return null;
      let response;
      try{response=await authGetUser(token)}catch{return null}
      if(response?.error||!uuid(response?.data?.user?.id))return null;
      // Ignore email, role claims and editable metadata supplied by the user.
      return {id:response.data.user.id};
    },
    async claimPaidAttempt({ownerId,provider,environment}={}){
      if(!uuid(ownerId)||provider!=='stripe_web'||environment!=='sandbox'||
         typeof claimPrivatePaid!=='function')
        return {status:'paid_unavailable'};
      let response;
      try{
        response=await claimPrivatePaid({
          p_owner_id:ownerId,p_authenticated_owner_id:ownerId,
          p_provider:'stripe_web',p_environment:'sandbox',
        });
      }catch{throw Error('paid_store_unavailable')}
      if(response?.error||!Array.isArray(response?.data)||
         response.data.length!==1)throw Error('paid_store_unavailable');
      const row=response.data[0];
      if(row?.owner_id!==ownerId)throw Error('paid_owner_mismatch');
      if(['subscription_unresolved','checkout_unresolved',
           'not_returning_customer'].includes(row.status))
        return {status:row.status};
      if(row.status!=='eligible_reserved'||!uuid(row.attempt_id)||
         row.trial_eligible!==false)throw Error('paid_store_invalid');
      return {status:'eligible_reserved',attemptId:row.attempt_id,
        ownerId,trialEligible:false};
    },
    async claimEligibleAttempt({ownerId,provider,environment}={}){
      if(!uuid(ownerId)||provider!=='stripe_web'||environment!=='sandbox')
        return {status:'trial_unavailable'};
      let response;
      try{
        response=await claimPrivateTrial({
          p_owner_id:ownerId,p_authenticated_owner_id:ownerId,
          p_provider:'stripe_web',p_environment:'sandbox',
        });
      }catch{throw Error('trial_store_unavailable')}
      if(response?.error||!Array.isArray(response?.data)||
         response.data.length!==1)throw Error('trial_store_unavailable');
      const row=response.data[0];
      if(row?.owner_id!==ownerId)throw Error('trial_owner_mismatch');
      if(row.status==='trial_ineligible')return {status:'trial_ineligible'};
      if(row.status==='trial_unavailable')return {status:'trial_unavailable'};
      if(row.status!=='eligible_reserved'||!uuid(row.attempt_id)||
         row.trial_eligible!==true)throw Error('trial_store_invalid');
      return {status:'eligible_reserved',
        attemptId:row.attempt_id,ownerId,trialEligible:true};
    },
  });
}
