import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/tokens';
import { RouteBuilderContent } from './routeBuilder/RouteBuilderContent';
import { RoutineBuilderContent } from './routines/RoutineBuilderContent';
import { RoutineWorkoutReviewContent } from './routines/RoutineWorkoutReviewContent';
import { SavedRoutineLibraryContent } from './routines/SavedRoutineLibraryContent';
import type {SavedRoutineReadServices} from './routines/savedRoutineOwnerReader';
import type {SavedRoutineMutationServices} from './routines/savedRoutineRpcWriter';
import type {CoachRoutineSuggestion,RoutineWorkoutReview,SavedRoutineOwnerSnapshot} from './routines/routineWorkoutReview';

type Workspace = 'routes' | 'routines';

/**
 * Routes mount the ported V1 interactive editor without unapproved legacy writers.
 * Routine storage and its editor remain separately gated by canonical V2 ownership.
 */
export function RoutesRoutinesContent({
 savedRoutineSnapshot,savedRoutineReaderServices,savedRoutineMutationServices,currentOwnerId,sessionGeneration,coachSuggestion,onStartRoutineWorkout,
}:{
 savedRoutineSnapshot?:SavedRoutineOwnerSnapshot|null;
 savedRoutineReaderServices?:SavedRoutineReadServices;
 savedRoutineMutationServices?:SavedRoutineMutationServices;
 currentOwnerId?:string|null;
 sessionGeneration?:number;
 coachSuggestion?:CoachRoutineSuggestion|null;
 onStartRoutineWorkout?:(review:RoutineWorkoutReview)=>void;
}={}) {
  const [selected, setSelected] = useState<Workspace>('routes');
  const [routineView,setRoutineView]=useState<'library'|'create'>('library');
  const [libraryRevision,setLibraryRevision]=useState(0);
  const [builderRevision,setBuilderRevision]=useState(0);
  // Unapproved sources cannot make a saved Routine appear connected.
  const certified=!!savedRoutineSnapshot&&!!currentOwnerId&&
    savedRoutineSnapshot.identity==='canonical_saved_routine'&&
    savedRoutineSnapshot.complete===true&&
    savedRoutineSnapshot.ownerId===currentOwnerId&&
    savedRoutineSnapshot.sessionGeneration===sessionGeneration&&
    Number.isSafeInteger(savedRoutineSnapshot.version)&&savedRoutineSnapshot.version>0;
  return <View style={styles.root}>
    <View accessibilityRole="tablist" style={styles.tabs}>
      {(['routes', 'routines'] as const).map(tab => (
        <Pressable
          key={tab} accessibilityRole="tab" accessibilityLabel={tab === 'routes' ? 'Routes' : 'Routines'}
          accessibilityState={{ selected: selected === tab }}
          onPress={() => setSelected(tab)}
          style={[styles.tab, selected === tab && styles.selected]}
        ><Text style={[styles.tabText, selected === tab && styles.selectedText]}>
          {tab === 'routes' ? 'Routes' : 'Routines'}
        </Text></Pressable>
      ))}
    </View>
    <View style={[styles.body, selected !== 'routes' && styles.hidden]}
      accessibilityElementsHidden={selected !== 'routes'}
      importantForAccessibility={selected === 'routes' ? 'auto' : 'no-hide-descendants'}>
      <Text accessibilityRole="header" style={styles.title}>Routes</Text>
      <RouteBuilderContent />
      <Text style={styles.muted}>Your existing saved routes have not been checked. Canonical route saving and provider-backed rerouting remain gated.</Text>
    </View>
    <View style={[styles.body, selected !== 'routines' && styles.hidden]}
      accessibilityElementsHidden={selected !== 'routines'}
      importantForAccessibility={selected === 'routines' ? 'auto' : 'no-hide-descendants'}>
      {certified&&savedRoutineSnapshot&&currentOwnerId&&sessionGeneration!==undefined?
        <RoutineWorkoutReviewContent
          key={savedRoutineSnapshot.routineId+':'+savedRoutineSnapshot.version+':'+sessionGeneration}
          snapshot={savedRoutineSnapshot} expectedOwnerId={currentOwnerId}
          sessionGeneration={sessionGeneration} suggestion={coachSuggestion}
          onStartWorkout={onStartRoutineWorkout}/> : null}
      {!certified&&savedRoutineReaderServices&&currentOwnerId&&
        sessionGeneration!==undefined?
        <View style={styles.viewRow}>
          <Pressable accessibilityRole="button"
            accessibilityState={{selected:routineView==='library'}}
            onPress={()=>setRoutineView('library')} style={styles.routineButton}>
            <Text style={styles.tabText}>My Routines</Text>
          </Pressable>
          <Pressable accessibilityRole="button"
            accessibilityState={{selected:routineView==='create'}}
            onPress={()=>setRoutineView('create')} style={styles.routineButton}>
            <Text style={styles.tabText}>Create Routine</Text>
          </Pressable>
        </View>:null}
      {!certified&&savedRoutineReaderServices&&currentOwnerId&&
        sessionGeneration!==undefined&&routineView==='library'?
        <SavedRoutineLibraryContent key={libraryRevision} services={savedRoutineReaderServices}
          expectedOwnerId={currentOwnerId} sessionGeneration={sessionGeneration}
          suggestion={coachSuggestion} onStartWorkout={onStartRoutineWorkout}/>:null}
      <View style={(certified||!!savedRoutineReaderServices&&routineView==='library')&&styles.hidden}
        accessibilityElementsHidden={certified||!!savedRoutineReaderServices&&routineView==='library'}
        importantForAccessibility={certified||!!savedRoutineReaderServices&&routineView==='library'
         ?'no-hide-descendants':'auto'}>
        <RoutineBuilderContent key={builderRevision}
         onSave={savedRoutineMutationServices&&currentOwnerId&&sessionGeneration!==undefined
          ?async(draft,actionId)=>{
           await savedRoutineMutationServices.saveFromUserAction({
            expectedOwnerId:currentOwnerId,sessionGeneration,routineId:null,
            expectedVersion:0,actionId,draft,
           });
           setBuilderRevision(v=>v+1);
           setLibraryRevision(v=>v+1);
           setRoutineView('library');
          }:undefined}/>
      </View>
      {!certified&&!savedRoutineReaderServices?<Text style={styles.muted}>Your saved routines have not been checked. This is an unsaved draft, not an accepted workout or persistent template.</Text>:null}
    </View>
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 16 },
  viewRow:{flexDirection:'row',gap:8},
  routineButton:{paddingHorizontal:12,minHeight:44,justifyContent:'center',borderRadius:8,borderWidth:1,borderColor:colors.border},
  hidden: { display: 'none' },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  selected: { borderBottomWidth: 2, borderBottomColor: colors.gold },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.mutedText },
  selectedText: { color: colors.goldSoft },
  body: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18, gap: 12 },
  title: { fontSize: 23, fontWeight: '900', color: colors.warmWhite },
  subheading: { fontSize: 16, fontWeight: '800', color: colors.goldSoft },
  muted: { fontSize: 13, color: colors.mutedText, lineHeight: 19 },
});
