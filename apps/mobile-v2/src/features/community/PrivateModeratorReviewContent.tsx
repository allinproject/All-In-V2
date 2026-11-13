/** ALL-244 private reviewer workspace.
 * Not a route and not in navigation. A trusted server gateway must be
 * approved and connected before rendering this for a real reviewer.
 * The React Native client never obtains private SQL table/RPC privileges.
 */
import {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,ScrollView,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens';
import {
 certifyCaseEvidence,certifyReviewQueue,certifyReviewResult,withFreshReviewer,
 type ModeratorReviewTransport,type ReviewCase,type ReviewCursor,
 type ReviewEvidence,type ReviewPermission,type ModerationDecision,
} from './moderatorReviewContract';

type Props={permission:ReviewPermission;transport:ModeratorReviewTransport;
 onClose:()=>void};
const title=(p:ReviewPermission)=>p==='initial_review'?'Reports to review':'Appeals to review';
const choices=(p:ReviewPermission):readonly ModerationDecision[]=>
 p==='initial_review'?['dismiss','hold','hide']:['uphold','overturn'];

export function PrivateModeratorReviewContent({permission,transport,onClose}:Props){
 const [items,setItems]=useState<readonly ReviewCase[]>([]);
 const [cursor,setCursor]=useState<ReviewCursor|null>(null);
 const [selection,setSelection]=useState<ReviewCase|null>(null);
 const [evidence,setEvidence]=useState<ReviewEvidence|null>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [authorized,setAuthorized]=useState(false);
 const epoch=useRef(0);
 const inFlight=useRef(false);
 const reset=useCallback(()=>{
  setItems([]);setCursor(null);setSelection(null);setEvidence(null);
  setAuthorized(false);
 },[]);
 const load=useCallback(async(next:ReviewCursor|null)=>{
  if(inFlight.current)return;
  inFlight.current=true;setBusy(true);setError('');
  const token=epoch.current;
  try{
   const result=await withFreshReviewer({transport,permission,
    execute:async()=>certifyReviewQueue(await transport.queue(permission,next),permission),
    isCurrent:()=>epoch.current===token});
   if(epoch.current!==token)return;
   setAuthorized(true);
   setItems(old=>next?[...old,...result.cases]:result.cases);
   setCursor(result.nextCursor);
  }catch{
   if(epoch.current===token){reset();setError('Private reviewer access unavailable. Sign in again or contact an operator.');}
  }finally{inFlight.current=false;if(epoch.current===token)setBusy(false);}
 },[transport,permission,reset]);
 useEffect(()=>{
  epoch.current++;reset();setError('');inFlight.current=false;
  void load(null);
  return ()=>{epoch.current++;};
 },[load,reset]);
 const openCase=async(item:ReviewCase)=>{
  if(inFlight.current||!authorized)return;
  inFlight.current=true;setBusy(true);setError('');setSelection(null);setEvidence(null);
  const token=epoch.current;
  try{
   const detail=await withFreshReviewer({permission,transport,
    execute:async()=>certifyCaseEvidence(
     await transport.evidence(item.reportId,permission),item.reportId,permission),
    isCurrent:()=>epoch.current===token});
   if(detail.version!==item.version)throw new Error('Case changed.');
   if(epoch.current!==token)return;
   setSelection(item);setEvidence(detail);
  }catch{
   if(epoch.current===token){reset();setError('Evidence access denied or case changed. Refresh your reviewer access.');}
  }finally{inFlight.current=false;if(epoch.current===token)setBusy(false);}
 };
 const decide=async(decision:ModerationDecision)=>{
  if(inFlight.current||!authorized||!selection||!evidence)return;
  inFlight.current=true;setBusy(true);setError('');
  const token=epoch.current;
  try{
   const current=selection;
   await withFreshReviewer({transport,permission,isCurrent:()=>epoch.current===token,
    execute:async()=>certifyReviewResult(
     await (permission==='initial_review'?
      transport.decide(current.reportId,current.version,decision as 'dismiss'|'hold'|'hide'):
      transport.resolveAppeal(current.reportId,current.version,decision as 'uphold'|'overturn')),
     current.reportId,current.version,decision)});
   if(epoch.current!==token)return;
   setSelection(null);setEvidence(null);
   // Re-read from server after every mutation. Never optimistically certify.
   setItems([]);setCursor(null);setAuthorized(false);
  }catch{
   if(epoch.current===token){reset();setError('Decision was not confirmed. The case may have changed; refresh before retrying.');}
  }finally{inFlight.current=false;if(epoch.current===token)setBusy(false);}
  if(epoch.current===token)void load(null);
 };
 const action=(label:string,press:()=>void,disabled=false)=>(
  <Pressable accessibilityRole="button" disabled={disabled} onPress={press}
   style={[styles.action,disabled&&styles.disabled]}>
   <Text style={styles.actionText}>{label}</Text>
  </Pressable>);
 return <View style={styles.root}>
  <View style={styles.top}><Text style={styles.heading}>{title(permission)}</Text>
   {action('Close',()=>{epoch.current++;reset();onClose();},busy)}</View>
  <Text style={styles.muted}>Restricted workspace · case access is audited · no public Community access</Text>
  {busy?<ActivityIndicator color={colors.gold}/>:null}
  {error?<Text accessibilityRole="alert" style={styles.warning}>{error}</Text>:null}
  {!authorized?<View style={styles.panel}>
    <Text style={styles.muted}>Cases are unavailable until a trusted reviewer session is verified.</Text>
    {!busy?action('Retry access',()=>{void load(null);}):null}
   </View>:
   <ScrollView contentContainerStyle={styles.list}>
    {selection&&evidence?<View style={styles.panel}>
     <Text style={styles.subheading}>Case evidence</Text>
     <Text style={styles.muted}>Report {selection.reportId} · revision {selection.version}</Text>
     <Text style={styles.body}>Reason: {evidence.reasonCode}</Text>
     <Text style={styles.body}>{evidence.reasonDetail}</Text>
     <Text style={styles.subheading}>Reported comment</Text>
     <Text style={styles.body}>{evidence.body}</Text>
     {permission==='appeal_review'&&evidence.appealStatement?
      <><Text style={styles.subheading}>Author appeal</Text>
       <Text style={styles.body}>{evidence.appealStatement}</Text></>:null}
     <View style={styles.actions}>
      {choices(permission).map(choice=><View key={choice}>
       {action(choice.replace('_',' '),()=>{void decide(choice);},busy)}</View>)}
      {action('Back to queue',()=>{setSelection(null);setEvidence(null);},busy)}
     </View>
    </View>:<>
     {!items.length?<Text style={styles.muted}>No eligible cases in this queue.</Text>:null}
     {items.map(item=><Pressable key={item.reportId}
      accessibilityRole="button" onPress={()=>{void openCase(item);}}
      disabled={busy} style={styles.panel}>
      <Text style={styles.body}>{item.reasonCode} · {item.status}</Text>
      <Text style={styles.muted}>Report {item.reportId}</Text>
      <Text style={styles.muted}>Version {item.version} · {item.submittedAt}</Text>
      <Text style={styles.link}>Open audited evidence</Text>
     </Pressable>)}
     {cursor?action('Load more cases',()=>{void load(cursor);},busy):null}
    </>}
   </ScrollView>}
 </View>;
}
const styles=StyleSheet.create({
 root:{flex:1,backgroundColor:colors.background,padding:18,gap:12},
 top:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12},
 heading:{fontSize:20,fontWeight:'800',color:colors.warmWhite,flex:1},
 subheading:{fontSize:15,fontWeight:'800',color:colors.warmWhite},
 list:{gap:12,paddingBottom:32},
 panel:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,
  borderColor:colors.border,padding:16,gap:10},
 muted:{color:colors.mutedText,fontSize:12,lineHeight:18},
 body:{color:colors.warmWhite,fontSize:14,lineHeight:20},
 link:{color:colors.goldSoft,fontWeight:'700',fontSize:12},
 warning:{color:colors.goldSoft,fontSize:13},
 actions:{flexDirection:'row',flexWrap:'wrap',gap:8},
 action:{paddingHorizontal:13,paddingVertical:9,borderRadius:8,
  borderWidth:1,borderColor:colors.gold,alignSelf:'flex-start'},
 actionText:{color:colors.goldSoft,fontSize:13,fontWeight:'700',textTransform:'capitalize'},
 disabled:{opacity:0.4},
});
