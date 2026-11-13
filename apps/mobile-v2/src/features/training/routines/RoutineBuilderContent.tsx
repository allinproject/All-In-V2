import {useMemo,useState} from 'react';
import {Pressable,ScrollView,StyleSheet,Text,TextInput,View} from 'react-native';
import {colors} from '../../../theme/tokens';
import type {TrainingSport} from '../trainingPlanSynthesis';
import {
 addRoutineBlock,changeRoutineSport,deleteRoutineBlock,duplicateRoutineBlock,inspectRoutineDraft,
 moveRoutineBlock,newRoutineDraft,renameRoutineDraft,setRoutineNotes,updateRoutineBlock,
 type RoutineBlock,type RoutineIntervalBlock,type RoutineStrengthBlock,
} from './routineDraftEditor';
import {applyRoutineDraftEdit,createRoutineDraftHistory,redoRoutineDraftEdit,undoRoutineDraftEdit} from './routineDraftHistory';

const choices:{sport:TrainingSport;label:string}[]=[
 {sport:'strength',label:'Strength'},{sport:'running',label:'Run'},{sport:'walking',label:'Walk'},
 {sport:'cycling',label:'Ride'},{sport:'swimming',label:'Swim'},{sport:'rowing',label:'Row'},
 {sport:'hiking',label:'Hike'},{sport:'rucking',label:'Ruck'},
 {sport:'elliptical',label:'Elliptical'},{sport:'stair',label:'Stairs'},
 {sport:'yoga',label:'Yoga'},{sport:'mobility',label:'Mobility'},{sport:'other',label:'Other'},
];
const intOrNull=(value:string):number|null=>{
 if(!value.trim())return null;
 const v=Number(value);return Number.isSafeInteger(v)&&v>=0?v:null;
};
const positiveOrNull=(value:string):number|null=>{
 if(!value.trim())return null;
 const v=Number(value);return Number.isFinite(v)&&v>0?v:null;
};
const strOrNull=(value:string)=>value.length?value:null;
const setTypes:RoutineStrengthBlock['setType'][]=['warmup','working','drop','failure'];
const phases:RoutineIntervalBlock['phase'][]=['warmup','work','recovery','cooldown'];
const units:NonNullable<RoutineIntervalBlock['distanceUnit']>[]=['meters','yards','kilometers','miles'];

function ChoiceRow<T extends string>({choices,selected,onSelect}:{choices:readonly T[];selected:T;onSelect:(value:T)=>void}){
 return <View style={styles.choiceRow}>{choices.map(value=><Pressable key={value}
  accessibilityRole="button" accessibilityState={{selected:selected===value}}
  onPress={()=>onSelect(value)} style={[styles.chip,selected===value&&styles.active]}>
  <Text style={[styles.chipText,selected===value&&styles.gold]}>{value.replaceAll('_',' ')}</Text>
 </Pressable>)}</View>;
}
function EditorInput({label,value,onChange,keyboardType,placeholder}:{label:string;value:string;
 onChange:(text:string)=>void;keyboardType?:'numeric'|'default';placeholder?:string}){
 return <View style={styles.field}><Text style={styles.fieldLabel}>{label}</Text>
  <TextInput accessibilityLabel={label} value={value} onChangeText={onChange}
   keyboardType={keyboardType??'default'} placeholder={placeholder} placeholderTextColor={colors.mutedText}
   style={styles.input}/></View>;
}
function BlockActions({position,count,onMove,onDuplicate,onDelete}:{position:number;count:number;
 onMove:(delta:-1|1)=>void;onDuplicate:()=>void;onDelete:()=>void}){
 return <View style={styles.choiceRow}>
  <Pressable accessibilityRole="button" accessibilityLabel="Move block up" disabled={position===0}
   onPress={()=>onMove(-1)} style={styles.chip}><Text style={styles.gold}>↑</Text></Pressable>
  <Pressable accessibilityRole="button" accessibilityLabel="Move block down" disabled={position===count-1}
   onPress={()=>onMove(1)} style={styles.chip}><Text style={styles.gold}>↓</Text></Pressable>
  <Pressable accessibilityRole="button" onPress={onDuplicate} style={styles.chip}><Text style={styles.gold}>Duplicate</Text></Pressable>
  <Pressable accessibilityRole="button" onPress={onDelete} style={styles.chip}><Text style={styles.gold}>Remove</Text></Pressable>
 </View>;
}
/** Actual in-session routine editor. Do not invent completion or infer load targets.
 * Canonical owner/versioned persistence, Coach Apply and Start Workout are NOT connected.
 */
export function RoutineBuilderContent(){
 const [history,setHistory]=useState(()=>createRoutineDraftHistory(newRoutineDraft()));
 const draft=history.present;
 const setDraft=(operation:(current:typeof draft)=>typeof draft)=>{
  setHistory(current=>applyRoutineDraftEdit(current,operation(current.present)));
 };
 const [sportConfirm,setSportConfirm]=useState<TrainingSport|null>(null);
 const review=useMemo(()=>inspectRoutineDraft(draft),[draft]);
 const update=(block:RoutineBlock)=>setDraft(current=>updateRoutineBlock(current,block));
 function setSport(sport:TrainingSport){
  if(sport===draft.sport)return;
  if(draft.blocks.length){setSportConfirm(sport);return;}
  setDraft(current=>changeRoutineSport(current,sport));
 }
 return <View style={styles.root}>
  <View style={styles.header}>
    <Text accessibilityRole="header" style={styles.title}>Create a Routine</Text>
    <View style={styles.choiceRow}>
      <Pressable accessibilityRole="button" accessibilityLabel="Undo routine edit"
        accessibilityState={{disabled:history.undo.length===0}}
        disabled={history.undo.length===0}
        onPress={()=>{setSportConfirm(null);setHistory(undoRoutineDraftEdit);}}
        style={[styles.chip,history.undo.length===0&&styles.disabled]}>
        <Text style={styles.gold}>Undo</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="Redo routine edit"
        accessibilityState={{disabled:history.redo.length===0}}
        disabled={history.redo.length===0}
        onPress={()=>{setSportConfirm(null);setHistory(redoRoutineDraftEdit);}}
        style={[styles.chip,history.redo.length===0&&styles.disabled]}>
        <Text style={styles.gold}>Redo</Text>
      </Pressable>
    </View>
  </View>
  <Text style={styles.note}>Build repeatable workout structure without recording a completed session. This draft stays in the open Train screen only. Saving, starting and scheduling require the approved private V2 Routine and Training services.</Text>
  <EditorInput label="Routine name" value={draft.name} onChange={value=>setDraft(s=>renameRoutineDraft(s,value))}/>
  <Text style={styles.heading}>Sport</Text>
  <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.sports}>{choices.map(item=><Pressable key={item.sport}
      accessibilityRole="button" accessibilityState={{selected:draft.sport===item.sport}}
      onPress={()=>setSport(item.sport)}
      style={[styles.chip,draft.sport===item.sport&&styles.active]}>
      <Text style={[styles.chipText,draft.sport===item.sport&&styles.gold]}>{item.label}</Text>
    </Pressable>)}</ScrollView>
  {sportConfirm ? <View style={styles.warning}>
    <Text style={styles.note}>Changing sports clears the current blocks because strength sets cannot be silently converted to endurance intervals. Keep your draft or explicitly clear the blocks?</Text>
    <View style={styles.choiceRow}>
      <Pressable accessibilityRole="button" onPress={()=>setSportConfirm(null)} style={styles.chip}><Text style={styles.gold}>Keep Draft</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={()=>{setDraft(s=>changeRoutineSport(s,sportConfirm));setSportConfirm(null);}}
        style={styles.chip}><Text style={styles.gold}>Clear Blocks & Change</Text></Pressable>
    </View>
  </View>:null}
  <EditorInput label="Routine notes (optional)" value={draft.notes}
    onChange={value=>setDraft(s=>setRoutineNotes(s,value))}
    placeholder="Purpose, equipment, or technique"/>
  <View style={styles.header}>
    <Text style={styles.heading}>{draft.sport==='strength'?'Ordered exercises':'Structured intervals'}</Text>
    <Pressable accessibilityRole="button" onPress={()=>setDraft(addRoutineBlock)}
      style={styles.add}><Text style={styles.addText}>+ Add {draft.sport==='strength'?'Exercise':'Interval'}</Text></Pressable>
  </View>
  {draft.blocks.map((block,index)=>{
    const actions={position:index,count:draft.blocks.length,
      onMove:(direction:-1|1)=>setDraft(s=>moveRoutineBlock(s,block.id,direction)),
      onDuplicate:()=>setDraft(s=>duplicateRoutineBlock(s,block.id)),
      onDelete:()=>setDraft(s=>deleteRoutineBlock(s,block.id))};
    if(block.kind==='strength')return <View key={block.id} style={styles.block}>
      <Text style={styles.blockTitle}>Exercise {index+1}</Text>
      <EditorInput label="Exercise name" value={block.exercise} placeholder="Name from exercise library or custom"
        onChange={exercise=>update({...block,exercise})}/>
      <ChoiceRow choices={setTypes} selected={block.setType} onSelect={setType=>update({...block,setType})}/>
      <View style={styles.choiceRow}>
        <Pressable accessibilityRole="button" onPress={()=>update({...block,sets:Math.max(1,block.sets-1)})}
          style={styles.chip}><Text style={styles.gold}>− Set</Text></Pressable>
        <Text style={styles.info}>{block.sets} set{block.sets===1?'':'s'}</Text>
        <Pressable accessibilityRole="button" onPress={()=>update({...block,sets:Math.min(20,block.sets+1)})}
          style={styles.chip}><Text style={styles.gold}>+ Set</Text></Pressable>
      </View>
      <View style={styles.columns}>
        <View style={styles.half}><EditorInput label="Target reps (optional)" value={block.reps??''}
          onChange={reps=>update({...block,reps:strOrNull(reps)})} placeholder="e.g. 8–10"/></View>
        <View style={styles.half}><EditorInput label="Target weight + unit (optional)" value={block.weight??''}
          onChange={weight=>update({...block,weight:strOrNull(weight)})} placeholder="e.g. 95 lb"/></View>
      </View>
      <View style={styles.columns}>
        <View style={styles.half}><EditorInput label="Rest seconds (optional)" value={block.restSeconds?.toString()??''}
          onChange={value=>update({...block,restSeconds:intOrNull(value)})} keyboardType="numeric"/></View>
        <View style={styles.half}><EditorInput label="Equipment (optional)" value={block.equipment??''}
          onChange={equipment=>update({...block,equipment:strOrNull(equipment)})}/></View>
      </View>
      <EditorInput label="Superset/circuit group ID (optional)" value={block.groupId??''}
        onChange={groupId=>update({...block,groupId:strOrNull(groupId)})} placeholder="e.g. A"/>
      <EditorInput label="Exercise notes" value={block.notes}
        onChange={notes=>update({...block,notes})}/>
      <BlockActions {...actions}/>
    </View>;
    return <View key={block.id} style={styles.block}>
      <Text style={styles.blockTitle}>Interval {index+1}</Text>
      <ChoiceRow choices={phases} selected={block.phase} onSelect={phase=>update({...block,phase})}/>
      <View style={styles.choiceRow}>
        <Pressable accessibilityRole="button" onPress={()=>update({...block,repetitions:Math.max(1,block.repetitions-1)})} style={styles.chip}><Text style={styles.gold}>− Repeat</Text></Pressable>
        <Text style={styles.info}>{block.repetitions} repeat{block.repetitions===1?'':'s'}</Text>
        <Pressable accessibilityRole="button" onPress={()=>update({...block,repetitions:Math.min(100,block.repetitions+1)})} style={styles.chip}><Text style={styles.gold}>+ Repeat</Text></Pressable>
      </View>
      <View style={styles.columns}>
        <View style={styles.half}><EditorInput label="Duration seconds (optional)"
          value={block.durationSeconds?.toString()??''} keyboardType="numeric"
          onChange={value=>update({...block,durationSeconds:intOrNull(value)})}/></View>
        <View style={styles.half}><EditorInput label="Distance (optional)"
          value={block.distance?.toString()??''} keyboardType="numeric"
          onChange={value=>update({...block,distance:positiveOrNull(value)})}/></View>
      </View>
      <Text style={styles.fieldLabel}>Distance units</Text>
      <View style={styles.choiceRow}>
        <Pressable accessibilityRole="button" onPress={()=>update({...block,distanceUnit:null})}
          style={[styles.chip,block.distanceUnit===null&&styles.active]}><Text style={styles.chipText}>Unspecified</Text></Pressable>
        {units.map(unit=><Pressable key={unit} accessibilityRole="button"
          accessibilityState={{selected:block.distanceUnit===unit}}
          onPress={()=>update({...block,distanceUnit:unit})}
          style={[styles.chip,block.distanceUnit===unit&&styles.active]}><Text style={styles.chipText}>{unit}</Text></Pressable>)}
      </View>
      <EditorInput label="Effort target (optional)" value={block.effort??''}
        onChange={effort=>update({...block,effort:strOrNull(effort)})}
        placeholder="RPE, HR, pace, power with units"/>
      <EditorInput label="Interval notes" value={block.notes}
        onChange={notes=>update({...block,notes})}/>
      <BlockActions {...actions}/>
    </View>;
  })}
  <View style={styles.review}>
    <Text style={styles.heading}>Draft review</Text>
    <Text style={styles.note}>{draft.blocks.length} block{draft.blocks.length===1?'':'s'} · Version {draft.version} (local only)</Text>
    <Text style={styles.note}>{review.ready?'Structure complete for owner-side review; not saved.':
      review.issues.join(' ')}</Text>
    <Text style={styles.note}>No completed workout, training plan, or Coach memory has been changed. Saved routine library and Start Workout are not connected.</Text>
  </View>
 </View>;
}
const styles=StyleSheet.create({
 root:{gap:12},title:{fontSize:21,fontWeight:'900',color:colors.warmWhite},
 heading:{fontSize:16,fontWeight:'800',color:colors.warmWhite},
 note:{fontSize:12,lineHeight:19,color:colors.mutedText},info:{fontSize:13,fontWeight:'800',color:colors.warmWhite},
 sports:{flexDirection:'row',gap:6,paddingVertical:3},header:{flexDirection:'row',gap:8,flexWrap:'wrap',alignItems:'center',justifyContent:'space-between'},
 choiceRow:{flexDirection:'row',gap:6,flexWrap:'wrap',alignItems:'center'},
 chip:{borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:10,minHeight:44,justifyContent:'center'},
 disabled:{opacity:0.4},
 active:{borderColor:colors.gold,backgroundColor:colors.surfaceRaised},
 chipText:{color:colors.mutedText,fontWeight:'700',fontSize:12},gold:{color:colors.goldSoft,fontWeight:'800',fontSize:12},
 field:{gap:4,flex:1},fieldLabel:{color:colors.mutedText,fontSize:12,fontWeight:'700'},
 input:{borderWidth:1,borderColor:colors.border,borderRadius:8,minHeight:44,color:colors.warmWhite,paddingHorizontal:10,fontSize:14},
 columns:{flexDirection:'row',gap:8},half:{flex:1,minWidth:0},
 add:{backgroundColor:colors.gold,minHeight:44,borderRadius:8,paddingHorizontal:12,justifyContent:'center'},
 addText:{color:colors.background,fontWeight:'900',fontSize:12},
 block:{padding:12,gap:10,borderColor:colors.border,borderWidth:1,borderRadius:12,backgroundColor:colors.surface},
 blockTitle:{color:colors.goldSoft,fontWeight:'800',fontSize:15},
 warning:{padding:12,gap:10,borderWidth:1,borderColor:colors.gold,borderRadius:8},
 review:{gap:8,borderTopWidth:2,borderColor:colors.gold,paddingVertical:16},
});
