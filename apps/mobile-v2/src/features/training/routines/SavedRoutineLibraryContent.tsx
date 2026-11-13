import {useEffect,useMemo,useRef,useState} from 'react';
import {ActivityIndicator,Pressable,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../../theme/tokens';
import {
 readAuthenticatedSavedRoutineList,readAuthenticatedSavedRoutineVersion,
 type SavedRoutineReadServices,type SavedRoutineSummary,
} from './savedRoutineOwnerReader';
import type {CoachRoutineSuggestion,RoutineWorkoutReview,SavedRoutineOwnerSnapshot} from './routineWorkoutReview';
import {RoutineWorkoutReviewContent} from './RoutineWorkoutReviewContent';

/**
 * A canonical Training owner supplies the authenticated versioned reader.
 * No reader is mounted by default. This UI never calls V1 or a guessed RPC.
 */
export function SavedRoutineLibraryContent({
 services,expectedOwnerId,sessionGeneration,suggestion,onStartWorkout,
}:{
 services:SavedRoutineReadServices;
 expectedOwnerId:string;
 sessionGeneration:number;
 suggestion?:CoachRoutineSuggestion|null;
 onStartWorkout?:(review:RoutineWorkoutReview)=>void;
}){
 const active=useRef(0);
 const [library,setLibrary]=useState<{
  status:'loading'|'ready'|'unavailable';records:SavedRoutineSummary[];
 }>({status:'loading',records:[]});
 const [selected,setSelected]=useState<{
  status:'loading'|'ready'|'unavailable';record:SavedRoutineOwnerSnapshot|null;
  routineId:string;version:number;
 }|null>(null);

 useEffect(()=>{
  const request=++active.current;
  setLibrary({status:'loading',records:[]});
  setSelected(null);
  readAuthenticatedSavedRoutineList(expectedOwnerId,sessionGeneration,services,
   ()=>active.current===request).then(result=>{
    if(active.current!==request)return;
    setLibrary(result.status==='ready'
     ?{status:'ready',records:result.records}
     :{status:'unavailable',records:[]});
   });
  return()=>{active.current++;};
 },[expectedOwnerId,sessionGeneration,services]);

 const sorted=useMemo(()=>[...library.records].sort((a,b)=>
  Number(b.isFavorite)-Number(a.isFavorite)||
  Date.parse(b.updatedAt)-Date.parse(a.updatedAt)),[library.records]);
 const select=(routine:SavedRoutineSummary)=>{
  const request=active.current;
  setSelected({status:'loading',record:null,routineId:routine.routineId,version:routine.version});
  readAuthenticatedSavedRoutineVersion({
   expectedOwnerId,sessionGeneration,routineId:routine.routineId,version:routine.version,
  },services,()=>active.current===request).then(result=>{
   if(active.current!==request)return;
   setSelected(current=>!current||current.routineId!==routine.routineId||
    current.version!==routine.version?current:{
     status:result.status,record:result.status==='ready'?result.record:null,
     routineId:routine.routineId,version:routine.version,
    });
  });
 };
 if(selected?.status==='ready'&&selected.record)return <View style={styles.root}>
  <Pressable accessibilityRole="button" style={styles.button}
   onPress={()=>setSelected(null)}><Text style={styles.gold}>Back to My Routines</Text></Pressable>
  <RoutineWorkoutReviewContent
   key={selected.record.routineId+':'+selected.record.version}
   snapshot={selected.record} expectedOwnerId={expectedOwnerId}
   sessionGeneration={sessionGeneration} suggestion={suggestion}
   onStartWorkout={onStartWorkout}/>
 </View>;
 return <View style={styles.root}>
  <Text accessibilityRole="header" style={styles.title}>My Routines</Text>
  {selected?.status==='loading'?<View style={styles.row}>
   <ActivityIndicator color={colors.gold}/>
   <Text style={styles.note}>Opening exact saved version…</Text>
  </View>:null}
  {selected?.status==='unavailable'?<View style={styles.root}>
   <Text style={styles.note}>This saved version is unavailable or your session changed. No routine was loaded.</Text>
   <Pressable accessibilityRole="button" style={styles.button}
    onPress={()=>setSelected(null)}><Text style={styles.gold}>Back to list</Text></Pressable>
  </View>:null}
  {library.status==='loading'?<View style={styles.row}>
   <ActivityIndicator color={colors.gold}/><Text style={styles.note}>Checking private routines…</Text>
  </View>:null}
  {library.status==='unavailable'?<Text style={styles.note}>
   Saved routines cannot be read. Check the account connection or try again later.
   This does not mean your routines were deleted.
  </Text>:null}
  {library.status==='ready'&&sorted.length===0?<Text style={styles.note}>
   No saved routines were returned by the complete private reader.
  </Text>:null}
  {library.status==='ready'&&sorted.map(record=><Pressable key={record.routineId}
   accessibilityRole="button" accessibilityLabel={`Open ${record.name} version ${record.version}`}
   onPress={()=>select(record)} style={styles.item}>
   <Text style={styles.itemTitle}>{record.name}{record.isFavorite?' ★':''}</Text>
   <Text style={styles.note}>{record.sport} · Version {record.version}</Text>
  </Pressable>)}
 </View>;
}
const styles=StyleSheet.create({
 root:{gap:12},row:{flexDirection:'row',gap:8,alignItems:'center'},
 title:{color:colors.warmWhite,fontSize:21,fontWeight:'900'},
 note:{color:colors.mutedText,fontSize:13,lineHeight:19},
 item:{padding:14,gap:5,borderColor:colors.border,borderWidth:1,
  borderRadius:10,backgroundColor:colors.surface,minHeight:66},
 itemTitle:{color:colors.warmWhite,fontWeight:'800',fontSize:15},
 button:{minHeight:44,borderColor:colors.border,borderWidth:1,
  paddingHorizontal:12,borderRadius:8,alignSelf:'flex-start',justifyContent:'center'},
 gold:{fontSize:13,fontWeight:'800',color:colors.goldSoft},
});
