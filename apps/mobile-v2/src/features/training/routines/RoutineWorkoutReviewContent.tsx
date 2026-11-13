import {useEffect,useMemo,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../../theme/tokens';
import {
  applyCoachChangeForSession,keepOriginalRoutineWorkout,
  openOwnedRoutineWorkoutReview,reviewCoachRoutineSuggestion,
  type CoachRoutineSuggestion,type RoutineWorkoutReview,type SavedRoutineOwnerSnapshot,
} from './routineWorkoutReview';
import {projectRoutineDraftPreview} from './routineDraftPreview';

/**
 * Only mount with an authenticated, complete canonical Saved Routine read.
 * Callback belongs to the approved Active Training owner, never this component.
 */
export function RoutineWorkoutReviewContent({
 snapshot,expectedOwnerId,sessionGeneration,suggestion,onStartWorkout,
}:{
 snapshot:SavedRoutineOwnerSnapshot;
 expectedOwnerId:string;
 sessionGeneration:number;
 suggestion?:CoachRoutineSuggestion|null;
 onStartWorkout?:(review:RoutineWorkoutReview)=>void;
}){
 const initial=useMemo(()=>openOwnedRoutineWorkoutReview(
   snapshot,expectedOwnerId,sessionGeneration),
 [snapshot,expectedOwnerId,sessionGeneration]);
 const [review,setReview]=useState<RoutineWorkoutReview|null>(initial);
 useEffect(()=>{setReview(initial)},[initial]);
 useEffect(()=>{
  if(!suggestion||!initial)return;
  setReview(current=>current?reviewCoachRoutineSuggestion(
    current,suggestion,expectedOwnerId,sessionGeneration):null);
 },[suggestion,initial,expectedOwnerId,sessionGeneration]);
 const valid=review&&review.ownerId===expectedOwnerId&&
  review.sessionGeneration===sessionGeneration&&
  review.routineId===snapshot.routineId&&review.routineVersion===snapshot.version;
 const details=review?projectRoutineDraftPreview(review.sessionDraft):null;
 if(!valid||!details)return <Text style={styles.note}>This saved workout is unavailable. Reopen it from your private routine library.</Text>;
 const ready=details.ready;
 return <View style={styles.root}>
  <Text accessibilityRole="header" style={styles.title}>{details.name}</Text>
  <Text style={styles.note}>{details.sport} · Routine version {review.routineVersion} · {details.rows.length} blocks</Text>
  <Pressable accessibilityRole="button"
   accessibilityState={{disabled:!onStartWorkout||!ready}}
   disabled={!onStartWorkout||!ready}
   onPress={()=>{if(review&&ready&&onStartWorkout&&review.ownerId===expectedOwnerId&&
    review.sessionGeneration===sessionGeneration&&review.routineId===snapshot.routineId&&
    review.routineVersion===snapshot.version)onStartWorkout(review);}}
   style={[styles.primary,(!onStartWorkout||!ready)&&styles.disabled]}>
   <Text style={styles.primaryText}>Start Workout</Text>
  </Pressable>
  {review.suggestion&&review.suggestionStatus==='proposed'?
    <View style={styles.suggestion}>
      <Text style={styles.heading}>Optional Coach suggestion</Text>
      <Text style={styles.note}>{review.suggestion.rationale}</Text>
      <Text style={styles.note}>Applies to this workout preview only. The saved Routine and Training Plan are unchanged.</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" style={styles.button}
         onPress={()=>setReview(current=>current?keepOriginalRoutineWorkout(current):current)}>
          <Text style={styles.buttonText}>Keep Original</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.button}
         onPress={()=>setReview(current=>current?applyCoachChangeForSession(current,expectedOwnerId,sessionGeneration):current)}>
          <Text style={styles.buttonText}>Apply Change</Text>
        </Pressable>
      </View>
    </View>:null}
  {review.suggestionStatus==='applied_for_session'?
    <Text style={styles.note}>Coach change selected for this session only. Your saved Routine remains unchanged.</Text>:null}
  {review.suggestionStatus==='kept_original'?
    <Text style={styles.note}>Original routine selected. No Coach change applied.</Text>:null}
  {details.rows.map(row=><View key={row.id} style={styles.block}>
    <Text style={styles.heading}>{row.title}</Text>
    {row.details.map((line,i)=><Text style={styles.note} key={i}>{line}</Text>)}
  </View>)}
  {details.totalDurationSeconds!==null?
    <Text style={styles.note}>Prescribed interval duration: {Math.floor(details.totalDurationSeconds/60)}m {details.totalDurationSeconds%60}s</Text>:
    <Text style={styles.note}>No complete duration prescription is available.</Text>}
  {!onStartWorkout?<Text style={styles.note}>Start Workout is unavailable until this Routine is connected to the canonical V2 session lifecycle.</Text>:null}
 </View>;
}
const styles=StyleSheet.create({
 root:{gap:12},title:{fontSize:22,fontWeight:'900',color:colors.warmWhite},
 heading:{fontSize:14,fontWeight:'800',color:colors.warmWhite},
 note:{fontSize:12,lineHeight:19,color:colors.mutedText},
 primary:{minHeight:48,backgroundColor:colors.gold,borderRadius:8,justifyContent:'center',alignItems:'center'},
 primaryText:{fontSize:15,fontWeight:'900',color:colors.background},disabled:{opacity:0.45},
 row:{flexDirection:'row',flexWrap:'wrap',gap:8},
 button:{paddingHorizontal:12,minHeight:44,borderColor:colors.border,borderWidth:1,borderRadius:8,justifyContent:'center'},
 buttonText:{fontSize:13,fontWeight:'800',color:colors.goldSoft},
 suggestion:{gap:8,padding:12,borderColor:colors.gold,borderWidth:1,borderRadius:10},
 block:{padding:12,gap:5,borderRadius:10,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},
});
