import {useEffect,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens';
import {EventPlanDetailContent} from './EventPlanDetailContent';
import {resolveSelectedEventPlan,type EventPlanOwnerProjection,type EventPlanSelection} from './eventPlanOwnerPresentation';

/**
 * Read-only rendering of an already-certified Event owner projection.
 * Never treats a missing server reader as a verified empty Event list.
 * Selection is local UI state, not an Event/Training mutation.
 */
export function EventPlanListContent({projection,ownerId,sessionGeneration}:{
  projection:EventPlanOwnerProjection;
  ownerId:string;
  sessionGeneration:number;
}){
  const [selection,setSelection]=useState<EventPlanSelection|null>(null);
  const current=projection.status==='ready'&&projection.ownerId===ownerId&&
    projection.authSessionGeneration===sessionGeneration&&!!ownerId.trim()&&
    Number.isSafeInteger(sessionGeneration)&&sessionGeneration>=0&&
    projection.events.every(e=>e.ownerId===ownerId);
  const snapshotVersion=current&&projection.status==='ready'?projection.snapshotVersion:null;
  const identityKey=JSON.stringify([ownerId,sessionGeneration,snapshotVersion]);
  useEffect(()=>setSelection(null),[identityKey]);
  if(!current||projection.status!=='ready')return (
    <View style={styles.card}>
      <Text accessibilityRole="header" style={styles.title}>Event Plan</Text>
      <Text style={styles.muted}>Your private Event Plans are not available yet because the certified Event reader is not connected. Existing events have not been checked and are not being reported as empty.</Text>
      <Text style={styles.muted}>Event website import, Coach strategy refresh and event editing are not active in this screen.</Text>
    </View>
  );
  const selected=resolveSelectedEventPlan(projection,ownerId,sessionGeneration,selection);
  if(selected)return (
    <View style={styles.container}>
      <Pressable accessibilityRole="button" onPress={()=>setSelection(null)}
        style={styles.back}>
        <Text style={styles.action}>‹ All Events</Text>
      </Pressable>
      <EventPlanDetailContent
        key={selected.ownerId+':'+selected.eventId+':'+selected.editionId+':'+selected.eventVersion}
        event={selected}
        expected={{ownerId:selected.ownerId,eventId:selected.eventId,
          editionId:selected.editionId,eventVersion:selected.eventVersion}}
      />
      <Text style={styles.muted}>Verified section information and any linked Training Plan will appear when their canonical owner readers are connected. No plan changes are available here.</Text>
    </View>
  );
  return <View style={styles.container}>
    <Text accessibilityRole="header" style={styles.title}>Upcoming Events</Text>
    {projection.events.length===0?(
      <Text style={styles.muted}>No upcoming events in the verified Event Plan list.</Text>
    ):projection.events.map(e=>(
      <Pressable key={e.eventId} accessibilityRole="button"
        accessibilityLabel={e.name+', '+e.eventDate+', open Event Plan'}
        onPress={()=>setSelection({
          ownerId,authSessionGeneration:sessionGeneration,
          snapshotVersion:projection.snapshotVersion,
          eventId:e.eventId,editionId:e.editionId,eventVersion:e.eventVersion,
        })} style={styles.card}>
        <Text style={styles.heading}>{e.name}</Text>
        <Text style={styles.muted}>{e.eventDate} · {e.discipline}</Text>
        {e.priority!==null&&<Text style={styles.muted}>Event priority: {e.priority}</Text>}
        <Text style={styles.action}>View Event Plan ›</Text>
      </Pressable>
    ))}
    <Text style={styles.muted}>Creating, changing and importing events require the canonical Event backend and are not available here yet.</Text>
  </View>;
}
const styles=StyleSheet.create({
  container:{gap:12},
  card:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,
    borderColor:colors.border,padding:16,gap:8},
  title:{color:colors.warmWhite,fontSize:20,fontWeight:'800'},
  heading:{color:colors.warmWhite,fontSize:16,fontWeight:'700'},
  muted:{color:colors.mutedText,fontSize:13,lineHeight:20},
  action:{color:colors.goldSoft,fontSize:14,fontWeight:'700'},
  back:{minHeight:44,justifyContent:'center'},
});
