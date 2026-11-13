import {useEffect,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens';
import {certifyEventPlanDetailIdentity,certifiedEventPlanSectionText,eventPlanSections,type EventPlanDetailIdentity,type EventPlanSectionId,type EventPlanSectionEvidence} from './eventPlanDetailSections';

/**
 * Read-only presentation for a future certified Event owner reader.
 * Parent ScrollView provides the one-page scrolling layout; this component
 * never fetches, saves, publishes, or substitutes mock event information.
 */
export function EventPlanDetailContent(props:{
  event:EventPlanDetailIdentity|null;
  expected:{ownerId:string;eventId:string;editionId:string;eventVersion:number};
  sectionEvidence?:readonly EventPlanSectionEvidence[];
}) {
  const [open,setOpen]=useState<EventPlanSectionId[]>(['overview']);
  const event=certifyEventPlanDetailIdentity(props.event,props.expected);
  const sectionText=event?certifiedEventPlanSectionText(event,props.sectionEvidence):{};
  const identityKey=`${props.expected.ownerId}:${props.expected.eventId}:${props.expected.editionId}:${props.expected.eventVersion}`;
  useEffect(()=>setOpen(['overview']),[identityKey]);
  if(!event)return (
    <View style={styles.card}>
      <Text style={styles.muted}>Event detail is unavailable until its exact athlete, event edition and version are verified.</Text>
    </View>
  );
  return <View key={`${event.ownerId}:${event.eventId}:${event.editionId}:${event.eventVersion}`} style={styles.container}>
    <Text accessibilityRole="header" style={styles.title}>{event.name}</Text>
    <Text style={styles.muted}>{event.eventDate} · {event.discipline}</Text>
    {eventPlanSections(event.discipline).map(section=>{
      const expanded=open.includes(section.id);
      return <View key={section.id} style={styles.card}>
        <Pressable accessibilityRole="button"
          accessibilityLabel={section.title}
          accessibilityState={{expanded}}
          onPress={()=>setOpen(previous=>expanded
            ?previous.filter(id=>id!==section.id):[...previous,section.id])}
          style={styles.header}>
          <Text style={styles.heading}>{section.title}</Text>
          <Text style={styles.heading}>{expanded?'−':'+'}</Text>
        </Pressable>
        {expanded&&<Text style={styles.muted}>
          {sectionText[section.id]??'Verified section information is not available yet.'}
        </Text>}
      </View>;
    })}
  </View>;
}
const styles=StyleSheet.create({
  container:{gap:12},
  card:{backgroundColor:colors.surface,borderRadius:14,borderWidth:1,borderColor:colors.border,padding:14,gap:10},
  title:{fontSize:23,fontWeight:'800',color:colors.warmWhite},
  heading:{color:colors.warmWhite,fontWeight:'700',fontSize:15,flexShrink:1},
  muted:{color:colors.mutedText,fontSize:13,lineHeight:20},
  header:{flexDirection:'row',justifyContent:'space-between',gap:10,minHeight:44,alignItems:'center'},
});
