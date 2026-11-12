import {useCallback, useEffect, useRef, useState} from 'react';
import {ActivityIndicator, Platform, Pressable, StyleSheet, Text, View} from 'react-native';
import {createNativeBillingServerClient} from './nativeBillingServerClient';
import {
  nativeBillingReleaseGate,
  prepareNativeBillingRuntime,
  type NativeBillingRuntime,
} from './nativeBillingRuntime';
import type {NativeBillingOutcome} from './nativeBillingFlow';
import {supabase} from '../../lib/supabase';
import {colors} from '../../theme/tokens';

type Action='purchase'|'restore';
const outcomeText:Record<NativeBillingOutcome,string>={
  server_entitled:'Your subscription has been verified for this account.',
  not_entitled:'No active subscription could be confirmed for this account.',
  purchase_pending:'Your purchase is pending verification. Check again shortly.',
  canceled:'The store purchase was canceled. No subscription was started here.',
  unsupported:'Native subscriptions are unavailable on this device.',
  needs_setup:'Subscriptions are not configured for this device yet.',
  verification_unavailable:'We could not verify the purchase. Please try restoring it later.',
  wrong_account:'The signed-in account changed. Sign in to the original account and try again.',
};

/**
 * ALL-266: Prepared, but intentionally dormant, account-owned native actions.
 * This component is only mounted by the parent AFTER all release gates pass.
 * The native module itself is lazy-loaded deeper in prepareNativeBillingRuntime.
 */
export function NativeBillingActions({
  ownerId,onVerified,
}:{ownerId:string;onVerified:()=>void}){
  const ownerRef=useRef<string|null>(ownerId);
  ownerRef.current=ownerId;
  const [runtime,setRuntime]=useState<NativeBillingRuntime|null>(null);
  const [initializing,setInitializing]=useState(true);
  const [busy,setBusy]=useState<Action|null>(null);
  const [message,setMessage]=useState<string|null>(null);

  useEffect(()=>{
    let active=true;
    ownerRef.current=ownerId;
    setRuntime(null);
    setInitializing(true);
    setMessage(null);
    if(!nativeBillingReleaseGate.enabled){
      setInitializing(false);
      return ()=>{active=false;ownerRef.current=null};
    }
    const platform=Platform.OS==='ios'||Platform.OS==='android'
      ?Platform.OS:'unknown';
    const server=createNativeBillingServerClient({
      client:supabase.functions,
      getOwner:()=>active?ownerRef.current:null,
    });
    void prepareNativeBillingRuntime({
      activation:nativeBillingReleaseGate,platform,server,
      getAuthenticatedOwner:()=>active?ownerRef.current:null,
    }).then(flow=>{
      if(active){
        setRuntime(flow);
        setInitializing(false);
      }
    }).catch(()=>{
      if(active){
        setRuntime(null);
        setInitializing(false);
        setMessage('Subscriptions are not available in this build.');
      }
    });
    return ()=>{
      active=false;
      ownerRef.current=null;
    };
  },[ownerId]);

  const run=useCallback(async(action:Action)=>{
    if(!nativeBillingReleaseGate.enabled||!runtime||busy)return;
    const startingOwner=ownerRef.current;
    if(!startingOwner||startingOwner!==ownerId)return;
    setBusy(action);
    setMessage(null);
    try{
      const outcome=await runtime[action]();
      if(ownerRef.current!==startingOwner)return;
      setMessage(outcomeText[outcome]);
      if(outcome==='server_entitled')onVerified();
    }catch{
      if(ownerRef.current===startingOwner){
        setMessage('The store is unavailable. Please retry later.');
      }
    }finally{
      if(ownerRef.current===startingOwner)setBusy(null);
    }
  },[runtime,busy,ownerId,onVerified]);

  // Defense in depth: even if a parent renders this by mistake, it exposes
  // no active purchase control while any release approval is missing.
  if(!nativeBillingReleaseGate.enabled||
     !nativeBillingReleaseGate.signedNativeBuild||
     !nativeBillingReleaseGate.storeCatalogApproved||
     !nativeBillingReleaseGate.serverSecurityApproved)return null;

  const disabled=initializing||!runtime||busy!==null;
  return <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel="Subscribe with device store"
      accessibilityState={{disabled}} disabled={disabled}
      onPress={()=>{void run('purchase')}}
      style={[styles.button,disabled&&styles.disabled]}>
      <Text style={styles.buttonText}>Subscribe with {Platform.OS==='ios'?'Apple': 'Google Play'}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel="Restore purchases"
      accessibilityState={{disabled}} disabled={disabled}
      onPress={()=>{void run('restore')}}
      style={[styles.button,disabled&&styles.disabled]}>
      <Text style={styles.buttonText}>Restore Purchases</Text>
    </Pressable>
    {busy?<ActivityIndicator accessibilityLabel="Verifying subscription" color={colors.gold}/>:null}
    {message?<Text accessibilityRole="alert" style={styles.message}>{message}</Text>:null}
  </View>;
}
const styles=StyleSheet.create({
  actions:{gap:12},
  button:{borderWidth:1,borderColor:colors.border,borderRadius:12,
    minHeight:48,alignItems:'center',justifyContent:'center'},
  disabled:{opacity:0.5},
  buttonText:{color:colors.warmWhite,fontWeight:'700'},
  message:{color:colors.warmWhite,lineHeight:21},
});
