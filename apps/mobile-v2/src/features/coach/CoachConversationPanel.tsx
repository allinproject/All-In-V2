import {useEffect,useRef,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {randomUUID} from 'expo-crypto';
import {supabase} from '../../lib/supabase.ts';
import {colors} from '../../theme/tokens.ts';
import {coachServicesForSupabase,createCoachOwnerClient,
 V2_COACH_READ_ENABLED,V2_COACH_SEND_ENABLED,
 type CoachMessage,type CoachSendCommand,type CoachHistoryCursor} from './coachOwnerClient.ts';
const secureId=()=>{try{return randomUUID()}catch{return null}};
const offline='Coach is not connected yet. Existing conversations are not assumed empty.';
export function CoachConversationPanel({ownerId}:{ownerId:string}){
 const [thread,setThread]=useState<string|null>(null);
 const [messages,setMessages]=useState<CoachMessage[]|null>(null);
 const [olderCursor,setOlderCursor]=useState<CoachHistoryCursor|null>(null);
 const [loadingOlder,setLoadingOlder]=useState(false);
 const [draft,setDraft]=useState('');
 const [busy,setBusy]=useState(false);
 const [notice,setNotice]=useState<string|null>(null);
 const [revision,setRevision]=useState(0);
 const mounted=useRef(true),saving=useRef(false);
 const historyEpoch=useRef(0);
 const candidate=useRef<string|null>(null);
 if(candidate.current===null)candidate.current=secureId();
 const retry=useRef<{text:string;command:CoachSendCommand}|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;retry.current=null}},[]);
 useEffect(()=>{
  let current=true;
  const epoch=++historyEpoch.current;
  setThread(null);setMessages(null);setOlderCursor(null);setLoadingOlder(false);
  if(!V2_COACH_READ_ENABLED||!candidate.current){
   setNotice(offline);return()=>{current=false};
  }
  const client=createCoachOwnerClient(coachServicesForSupabase(supabase),
   ownerId,()=>current&&mounted.current);
  setBusy(true);
  void (async()=>{
   const opened=await client.open(candidate.current!);
   if(!current||!mounted.current)return;
   if(opened.status!=='ready'){setNotice(offline);return;}
   setThread(opened.threadId);
   const history=await client.history(opened.threadId);
   if(!current||!mounted.current)return;
   if(history.status!=='ready'){setNotice(offline);return;}
   setMessages([...history.messages].reverse());
   setOlderCursor(history.nextCursor);
   setNotice(history.hasMore?'Showing recent saved history. Load older messages above.':null);
  })().catch(()=>{if(current&&mounted.current)setNotice(offline)})
   .finally(()=>{if(current&&mounted.current)setBusy(false)});
  return()=>{current=false;if(historyEpoch.current===epoch)historyEpoch.current++};
 },[ownerId,revision]);
 const loadOlder=()=>{
  if(!thread||!olderCursor||loadingOlder||busy||!messages)return;
  const existingMessages=messages;
  const capturedCursor=olderCursor,capturedThread=thread;
  const capturedEpoch=historyEpoch.current;
  setLoadingOlder(true);
  const client=createCoachOwnerClient(coachServicesForSupabase(supabase),
   ownerId,()=>mounted.current&&historyEpoch.current===capturedEpoch);
  void client.history(capturedThread,capturedCursor).then(page=>{
   if(!mounted.current||historyEpoch.current!==capturedEpoch)return;
   if(page.status!=='ready'){
    setNotice('Older saved Coach history could not be verified.');
    return;
   }
   const known=new Set(existingMessages.map(m=>m.id));
   if(page.messages.some(m=>known.has(m.id))){
    setNotice('Coach history changed during paging. Refresh to reconcile.');
    return;
   }
   setMessages(previous=>previous?[...page.messages].reverse().concat(previous):previous);
   setOlderCursor(page.nextCursor);
  }).catch(()=>{
   if(mounted.current&&historyEpoch.current===capturedEpoch)
    setNotice('Older history is unavailable.');
  }).finally(()=>{
   if(mounted.current&&historyEpoch.current===capturedEpoch)setLoadingOlder(false);
  });
 };
 const send=()=>{
  if(!V2_COACH_SEND_ENABLED||!V2_COACH_READ_ENABLED||!thread||!messages||
     !draft.trim()||saving.current)return;
  const text=draft.trim();
  let command=retry.current?.text===text?retry.current.command:null;
  if(!command){
   const ids=[secureId(),secureId(),secureId()];
   if(ids.some(id=>id===null)){setNotice('Secure message IDs are unavailable.');return;}
   command={threadId:thread,clientRequestId:ids[0]!,userMessageId:ids[1]!,
    assistantMessageId:ids[2]!,message:text};
   retry.current={text,command};
  }
  saving.current=true;setBusy(true);setNotice(null);
  const client=createCoachOwnerClient(coachServicesForSupabase(supabase),
   ownerId,()=>mounted.current,true,true);
  void client.send(command).then(r=>{
   if(!mounted.current)return;
   if(r.status==='saved'){
    retry.current=null;setDraft('');historyEpoch.current++;setRevision(v=>v+1);
   }else setNotice('Save not confirmed. Retry unchanged or refresh saved messages.');
  }).catch(()=>{if(mounted.current)setNotice('Coach reply could not be verified.')})
   .finally(()=>{saving.current=false;if(mounted.current)setBusy(false)});
 };
 return <View style={styles.card}>
  <Text accessibilityRole="header" style={styles.heading}>Your Coach</Text>
  <Text style={styles.muted}>Private conversation. Verified plans and restrictions outrank old suggestions.</Text>
  {messages===null?<Text style={styles.notice}>{notice??(busy?'Loading saved Coach history…':offline)}</Text>:
   <View style={styles.historyShell}>
    {olderCursor?<Pressable accessibilityRole="button" accessibilityLabel="Load older saved Coach messages"
     disabled={loadingOlder||busy} onPress={loadOlder}>
     <Text style={styles.link}>{loadingOlder?'Loading older messages…':'Load older saved messages'}</Text>
    </Pressable>:null}
   <ScrollView style={styles.scroll} contentContainerStyle={styles.messages}>
    {messages.length===0?<Text style={styles.muted}>No messages in the verified conversation.</Text>:
     messages.map(m=><View key={m.id} style={styles.bubble}>
      <Text style={styles.role}>{m.role==='user'?'You':'Coach'}</Text>
      <Text style={styles.body}>{m.content}</Text>
     </View>)}
   </ScrollView>
   </View>}
  {notice&&messages!==null?<Text style={styles.notice}>{notice}</Text>:null}
  {V2_COACH_READ_ENABLED&&thread?<Pressable accessibilityRole="button"
   accessibilityLabel="Refresh saved Coach history" disabled={busy}
   onPress={()=>{historyEpoch.current++;setRevision(v=>v+1)}}>
   <Text style={styles.link}>Refresh saved messages</Text></Pressable>:null}
  {V2_COACH_SEND_ENABLED&&V2_COACH_READ_ENABLED&&thread&&messages?
   <View style={styles.compose}>
    <TextInput accessibilityLabel="Coach message" multiline style={styles.input}
     placeholder="Ask Coach…" placeholderTextColor={colors.mutedText}
     editable={!busy} value={draft} maxLength={12000}
     onChangeText={v=>{if(v!==retry.current?.text)retry.current=null;setDraft(v)}}/>
    <Pressable accessibilityRole="button" accessibilityLabel="Send to Coach"
     disabled={busy||!draft.trim()} style={styles.button} onPress={send}>
     <Text style={styles.buttonText}>{busy?'Saving…':'Send'}</Text></Pressable>
   </View>:
   <Text style={styles.muted}>Messaging opens after authenticated staging and spending acceptance.</Text>}
 </View>;
}
const styles=StyleSheet.create({
 card:{padding:18,borderRadius:18,backgroundColor:colors.surface,gap:14},
 heading:{color:colors.warmWhite,fontSize:24,fontWeight:'800'},
 muted:{color:colors.mutedText,fontSize:14,lineHeight:22},
 notice:{color:colors.goldSoft,fontSize:14,lineHeight:22},
 historyShell:{gap:6},scroll:{maxHeight:450},messages:{gap:10,paddingBottom:6},
 bubble:{backgroundColor:colors.surfaceRaised,padding:13,borderRadius:12,gap:6},
 role:{fontSize:12,fontWeight:'800',color:colors.goldSoft},
 body:{color:colors.warmWhite,fontSize:15,lineHeight:22},
 link:{color:colors.goldSoft,fontWeight:'700',paddingVertical:10},
 compose:{gap:10},input:{minHeight:76,borderColor:colors.border,
  borderWidth:1,borderRadius:12,padding:12,color:colors.warmWhite},
 button:{backgroundColor:colors.gold,minHeight:46,borderRadius:12,
  justifyContent:'center',alignItems:'center'},
 buttonText:{fontWeight:'800',color:colors.background}
});
