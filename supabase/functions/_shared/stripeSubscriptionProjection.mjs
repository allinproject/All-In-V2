/**
 * ALL-252: provider-current Stripe subscription -> minimal entitlement fact.
 * Do NOT use webhook snapshot timestamps as revision numbers. Database writer
 * must determine serial revision under the owner/purchase lock.
 * Strict on item-level current_period_end (Stripe Basil+), product and price.
 * This normalizer cannot verify purchase ownership or source authenticity.
 */
export function projectStripeSandboxSubscription({
  subscription,approvedPriceId,approvedProductId,nowSeconds,
}={}){
  if(!subscription||subscription.object!=='subscription'||
     subscription.livemode!==false||
     typeof subscription.id!=='string'||!subscription.id.startsWith('sub_')||
     typeof subscription.customer!=='string'||!subscription.customer.startsWith('cus_')||
     !Number.isSafeInteger(nowSeconds)||nowSeconds<0||
     typeof approvedPriceId!=='string'||!approvedPriceId.startsWith('price_')||
     typeof approvedProductId!=='string'||!approvedProductId.startsWith('prod_')||
     !Array.isArray(subscription.items?.data)||
     subscription.items.data.length!==1)
    return {status:'unverified_provider_state'};
  const item=subscription.items.data[0],price=item?.price;
  if(!price||price.id!==approvedPriceId||price.product!==approvedProductId||
     price.currency!=='usd'||price.unit_amount!==999||
     price.type!=='recurring'||price.recurring?.interval!=='month'||
     price.recurring.interval_count!==1||item.quantity!==1)
    return {status:'unapproved_offer'};
  const status=subscription.status;
  const disabled=new Set(['past_due','unpaid','incomplete','incomplete_expired',
    'paused','canceled']);
  if(!['trialing','active'].includes(status)&&!disabled.has(status))
    return {status:'unverified_provider_state'};
  if(disabled.has(status)){
    return {status:'verified_state',phase:status==='canceled'?'revoked':
      ['past_due','unpaid','incomplete'].includes(status)?'billing_retry':'expired',
      accessUntil:null,providerSubscriptionId:subscription.id};
  }
  // From Stripe 2025-03-31.basil, billing dates are per subscription item.
  // Never fall back to deleted subscription-level current_period_end fields.
  const period=item.current_period_end;
  if(!Number.isSafeInteger(period)||period<=0)
    return {status:'unverified_provider_state'};
  let end=period;
  if(status==='trialing'){
    if(!Number.isSafeInteger(subscription.trial_end)||subscription.trial_end<=0)
      return {status:'unverified_provider_state'};
    end=Math.min(end,subscription.trial_end);
  }else if(subscription.cancel_at!=null){
    if(!Number.isSafeInteger(subscription.cancel_at)||subscription.cancel_at<=0)
      return {status:'unverified_provider_state'};
    end=Math.min(end,subscription.cancel_at);
  }
  if(end<=nowSeconds)
    return {status:'verified_state',phase:'expired',accessUntil:null,
      providerSubscriptionId:subscription.id};
  return {status:'verified_state',
    phase:status==='trialing'?'trial':
      subscription.cancel_at_period_end===true||subscription.cancel_at!=null?
        'canceling':'paid',
    accessUntil:new Date(end*1000).toISOString(),
    providerSubscriptionId:subscription.id};
}
