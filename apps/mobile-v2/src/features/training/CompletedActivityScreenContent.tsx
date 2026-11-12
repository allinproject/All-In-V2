import {useMemo,useState} from 'react';
import {Pressable,StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens';
import {CompletedActivityCustomizePanel} from './CompletedActivityCustomizePanel';
import {buildCompletedActivityScreenModel,type CompletedActivityScreenInput,type CompletedActivityTab} from './completedActivityScreenModel';
import {metricEvidenceQualityNotice} from './completedActivityDetailProjection';
import type {MetricLayout} from './completedActivityLayouts';

export type CompletedActivityContentProps={
 /** Already owner-verified canonical activity evidence; this component never fetches, invents, or writes workout metrics. */
 activity:CompletedActivityScreenInput;
 /** Parent must perform expected-owner/version/idempotent settings save. */
 onSaveLayout?:(pane:'overview'|'details',next:MetricLayout|null)=>Promise<void>;
 onOpenCoach?:()=>void;
 onEditCompletedMetadata?:()=>void;
 savingPreferences?:boolean;
};
/** Reusable V1-standard Completed Activity UI. Not a live route until ALL-243 reader exists. */
export function CompletedActivityScreenContent({activity,onSaveLayout,onOpenCoach,onEditCompletedMetadata,
 savingPreferences=false}:CompletedActivityContentProps){
 const [tab,setTab]=useState<CompletedActivityTab>('Overview');
 const [editing,setEditing]=useState(false);
 const [draft,setDraft]=useState<MetricLayout|null>(null);
 const [saving,setSaving]=useState(false),[error,setError]=useState<string|null>(null);
 const model=useMemo(()=>buildCompletedActivityScreenModel(activity),[activity]);
 const pane=tab==='Overview'?'overview':tab==='Details'?'details':null;
 const currentLayout=pane?(pane==='overview'?activity.overviewLayout:activity.detailsLayout):undefined;
 const activeLayout=draft??currentLayout??{order:[],pinned:[],hidden:[]};
 const activeMetrics=pane?model.customization[pane]:[];
 const listed=tab==='Overview'?model.stats.overview:model.stats.details;
 const canEdit=Boolean(onSaveLayout)&&!savingPreferences&&!saving;
 function switchTab(next:CompletedActivityTab){setTab(next);setEditing(false);setDraft(null);setError(null);}
 async function save(next:MetricLayout|null){
  if(!pane||!onSaveLayout||saving||savingPreferences)return;
  setSaving(true);setError(null);
  try{await onSaveLayout(pane,next);setEditing(false);setDraft(null);}
  catch(e){setError(e instanceof Error?e.message:'Could not save your layout.');}
  finally{setSaving(false);}
 }
 return <View style={styles.container}>
  <Text style={styles.title} accessibilityRole="header">{model.title}</Text>
  <Text style={styles.helper}>{model.sportLabel} · {model.completedAt}</Text>
  <Text style={styles.source}>Source: {model.sourceLabel}</Text>
  {model.terrain?<Text style={styles.helper}>Terrain: {model.terrain==='trail'?'Trail':'Road'}</Text>:null}
  <View style={styles.tabs}>{model.tabs.map(next=><Pressable key={next} accessibilityRole="tab"
    accessibilityState={{selected:tab===next}} style={[styles.tab,tab===next&&styles.selected]}
    onPress={()=>switchTab(next)}><Text style={tab===next?styles.selectedText:styles.tabText}>{next}</Text></Pressable>)}</View>
  {pane?<View style={styles.content}>
   <View style={styles.headingRow}><Text style={styles.heading}>{tab==='Overview'?'Activity Summary':'All Recorded Statistics'}</Text>
    {canEdit?<Pressable accessibilityRole="button" accessibilityLabel={'Customize '+tab}
     onPress={()=>{setEditing(x=>!x);setDraft(null);setError(null)}}>
      <Text style={styles.gold}>{editing?'Close':'Customize'}</Text></Pressable>:null}
   </View>
   {editing&&pane&&onSaveLayout?<View style={styles.content}>
    <CompletedActivityCustomizePanel sportLabel={model.sportLabel} pane={pane} available={activeMetrics}
     layout={activeLayout} onChange={setDraft} onRestoreDefaults={()=>{setDraft({order:[],pinned:[],hidden:[]})}}
     disabled={saving||savingPreferences}/>
    {error?<Text style={styles.error} accessibilityRole="alert">{error}</Text>:null}
    <View style={styles.actions}>
     <Pressable style={styles.outline} accessibilityRole="button" disabled={saving||savingPreferences}
      onPress={()=>{setEditing(false);setDraft(null);setError(null)}}>
      <Text style={styles.gold}>Cancel</Text></Pressable>
     <Pressable style={styles.save} accessibilityRole="button" disabled={saving||savingPreferences}
      onPress={()=>void save(draft??currentLayout??null)}>
      <Text style={styles.saveText}>{saving||savingPreferences?'Saving…':'Save Layout'}</Text></Pressable>
     <Pressable style={styles.outline} accessibilityRole="button" disabled={saving||savingPreferences}
      onPress={()=>void save(null)}><Text style={styles.gold}>Restore Defaults</Text></Pressable>
    </View>
   </View>:null}
   {listed.length===0?<Text style={styles.helper}>No source-backed statistics were available for this activity.</Text>:null}
   {listed.map(metric=><View style={styles.metric} key={metric.key}>
    <Text style={styles.helper}>{metric.label}</Text>
    <Text style={styles.value}>{metric.value}</Text>
    {tab==='Details'?<Text style={styles.source}>{metric.provenance} · {metric.source}</Text>:null}
    {metricEvidenceQualityNotice(metric)?<Text style={styles.quality} accessibilityLabel={'Data quality: '+metricEvidenceQualityNotice(metric)}>
      {metricEvidenceQualityNotice(metric)}
     </Text>:null}
   </View>)}
   {tab==='Details'&&model.stats.hiddenMetricKeys.length>0?<Text style={styles.helper}>
    {model.stats.hiddenMetricKeys.length} statistic(s) hidden by your layout. Customize to show them again.
   </Text>:null}
   {tab==='Details'&&model.stats.sections.map(section=><View key={section.key} style={styles.section}>
    <Text style={styles.heading}>{section.title}</Text>
    <Text style={styles.helper}>{section.count} recorded item(s) · {section.source}</Text>
    <Text style={styles.source}>Detailed {section.kind.replace(/_/g,' ')} visualization opens when its authorized source reader is connected.</Text>
   </View>)}
   {tab==='Overview'&&onEditCompletedMetadata?<Pressable accessibilityRole="button" style={styles.outline}
    onPress={onEditCompletedMetadata}><Text style={styles.gold}>Edit terrain, gear, effort & notes</Text></Pressable>:null}
  </View>:<View style={styles.content}>
   <Text style={styles.heading}>Coach Analysis</Text>
   {model.coach?<><Text style={styles.body}>{model.coach.summary}</Text>
    {model.coach.reasons.map((reason,index)=><Text key={index} style={styles.helper}>• {reason}</Text>)}
   </>:<Text style={styles.helper}>No Coach analysis is available for this activity yet. An analysis must be based on the actual recorded workout.</Text>}
   {onOpenCoach?<Pressable accessibilityRole="button" style={styles.outline} onPress={onOpenCoach}>
    <Text style={styles.gold}>Discuss This Activity With Coach</Text>
   </Pressable>:null}
  </View>}
 </View>;
}
const styles=StyleSheet.create({
 container:{backgroundColor:colors.background,padding:14,gap:14},
 title:{fontSize:26,color:colors.warmWhite,fontWeight:'800'},helper:{fontSize:13,color:colors.mutedText,lineHeight:19},
 source:{fontSize:11,color:colors.mutedText},body:{color:colors.warmWhite,lineHeight:22},
 tabs:{flexDirection:'row',gap:6},tab:{flex:1,borderWidth:1,borderColor:colors.border,borderRadius:10,minHeight:46,alignItems:'center',justifyContent:'center'},
 selected:{backgroundColor:colors.gold,borderColor:colors.gold},selectedText:{color:colors.background,fontWeight:'800',fontSize:13},
 tabText:{color:colors.warmWhite,fontWeight:'700',fontSize:13},
 content:{gap:12},headingRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:8},
 heading:{fontSize:17,fontWeight:'800',color:colors.warmWhite},gold:{color:colors.goldSoft,fontWeight:'700'},
 metric:{borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,borderRadius:12,padding:12,gap:5},
 value:{fontSize:20,fontWeight:'800',color:colors.warmWhite},
 quality:{fontSize:12,fontWeight:'700',color:colors.goldSoft},
 section:{borderWidth:1,borderColor:colors.border,borderRadius:12,padding:12,gap:6},
 actions:{gap:9},outline:{borderWidth:1,borderColor:colors.border,minHeight:44,alignItems:'center',justifyContent:'center',padding:10,borderRadius:11},
 save:{backgroundColor:colors.gold,minHeight:44,alignItems:'center',justifyContent:'center',padding:10,borderRadius:11},
 saveText:{color:colors.background,fontWeight:'800'},error:{color:colors.danger},
});
