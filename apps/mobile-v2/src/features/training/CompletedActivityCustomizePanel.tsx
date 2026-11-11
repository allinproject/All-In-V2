import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens';
import {moveMetric,presentMetrics,toggleMetricHidden,toggleMetricPin,
 type LayoutMetric,type MetricLayout} from './completedActivityLayouts';

type Props={
 sportLabel:string;pane:'overview'|'details';available:readonly LayoutMetric[];
 layout:MetricLayout;onChange:(next:MetricLayout)=>void;onRestoreDefaults:()=>void;
 disabled?:boolean;
};
/** Used inside a real Completed Activity's Overview/Details Customize surface.
 * The parent owns its authenticated versioned preference save. Does NOT mutate metrics.
 */
export function CompletedActivityCustomizePanel({sportLabel,pane,available,layout,onChange,onRestoreDefaults,disabled=false}:Props){
 const ordered=presentMetrics(available,{...layout,hidden:[]});
 const hidden=new Set(layout.hidden),pinned=new Set(layout.pinned);
 const act=(fn:()=>MetricLayout)=>{if(!disabled)onChange(fn())};
 return <View style={styles.container}>
  <Text style={styles.title}>Customize {pane==='details'?'Details':'Overview'}</Text>
  <Text style={styles.sub}>{sportLabel} · Move, pin, or hide optional statistics. This changes your layout, not the saved activity data or Coach analysis.</Text>
  {available.length===0?<Text style={styles.sub}>No source-backed statistics available for this activity.</Text>:null}
  {ordered.map((metric,index)=><View key={metric.key} style={styles.row}>
   <View style={styles.summary}>
    <Text style={styles.name}>{metric.label}</Text>
    {metric.required?<Text style={styles.sub}>Required source / safety information</Text>:null}
   </View>
   <View style={styles.actions}>
    <Pressable accessibilityRole="button" accessibilityLabel={'Move '+metric.label+' up'} disabled={disabled||index===0}
      style={styles.action} onPress={()=>act(()=>moveMetric(layout,metric.key,'up',available))}>
      <Text style={[styles.actionLabel,(disabled||index===0)&&styles.dim]}>↑</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={'Move '+metric.label+' down'} disabled={disabled||index===ordered.length-1}
      style={styles.action} onPress={()=>act(()=>moveMetric(layout,metric.key,'down',available))}>
      <Text style={[styles.actionLabel,(disabled||index===ordered.length-1)&&styles.dim]}>↓</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={(pinned.has(metric.key)?'Unpin ':'Pin ')+metric.label}
      disabled={disabled} style={styles.action} onPress={()=>act(()=>toggleMetricPin(layout,metric.key,available))}>
      <Text style={styles.actionLabel}>{pinned.has(metric.key)?'★':'☆'}</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityLabel={(hidden.has(metric.key)?'Show ':'Hide ')+metric.label}
      disabled={disabled||metric.required} style={styles.action} onPress={()=>act(()=>toggleMetricHidden(layout,metric.key,available))}>
      <Text style={[styles.actionLabel,metric.required&&styles.dim]}>{metric.required?'Locked':hidden.has(metric.key)?'Show':'Hide'}</Text>
    </Pressable>
   </View>
   {hidden.has(metric.key)&&!metric.required?<Text style={styles.sub}>Hidden from your current view, but still recorded.</Text>:null}
  </View>)}
  <Pressable accessibilityRole="button" disabled={disabled} style={styles.restore} onPress={onRestoreDefaults}>
   <Text style={styles.restoreText}>Restore recommended defaults</Text>
  </Pressable>
 </View>;
}
const styles=StyleSheet.create({
 container:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,borderRadius:16,padding:15,gap:12},
 title:{fontWeight:'800',fontSize:18,color:colors.warmWhite},
 sub:{fontSize:12,lineHeight:18,color:colors.mutedText},
 row:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:12,gap:8},
 summary:{gap:2},name:{color:colors.warmWhite,fontSize:14,fontWeight:'700'},
 actions:{flexDirection:'row',flexWrap:'wrap',gap:6},
 action:{minHeight:44,minWidth:44,borderWidth:1,borderColor:colors.border,borderRadius:9,justifyContent:'center',alignItems:'center',paddingHorizontal:9},
 actionLabel:{fontWeight:'800',color:colors.goldSoft,fontSize:12},dim:{opacity:0.35},
 restore:{minHeight:48,borderWidth:1,borderColor:colors.gold,borderRadius:12,alignItems:'center',justifyContent:'center',paddingHorizontal:10},
 restoreText:{color:colors.goldSoft,fontWeight:'800'},
});
