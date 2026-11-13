import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../../../theme/tokens';
import { RouteMapCanvas } from './RouteMapCanvas';
import {
  addRouteWaypoint, createManualRouteEditor, deleteRouteWaypoint,
  moveRouteWaypoint, redoRouteEdit, renameRoute, reorderRouteWaypoint,
  setRouteEndpoint, setRouteShape, shapeRouteWithFreehand, undoRouteEdit,
  type RoutePoint,
} from './trainingRouteEditor';
import type { RouteShape, RouteSport } from './trainingRouteTypes';

type MapMode = 'pan'|'start'|'end'|'waypoint'|'freehand';
const shapes: readonly { key: Exclude<RouteShape,'unknown'>; label: string }[] = [
  { key: 'loop', label: 'Loop' },
  { key: 'out_and_back', label: 'Out & Back' },
  { key: 'point_to_point', label: 'Point to Point' },
];
const sports: readonly { key: RouteSport; label: string }[] = [
  { key: 'run', label: 'Run' }, { key: 'ride', label: 'Ride' },
  { key: 'hike', label: 'Hike' }, { key: 'ruck', label: 'Ruck' },
];
/**
 * V1 editor and gesture map brought into V2 without importing any V1 persistence.
 * No fake route distance, snap-to-road result, provider evidence, or Saved status:
 * the existing V2 owner-scoped route writer and provider require separate approval.
 */
export function RouteBuilderContent() {
  const [state, setState] = useState(() => createManualRouteEditor({sport:'run',name:'Untitled Route'}));
  const [mode, setMode] = useState<MapMode>('pan');
  const [center, setCenter] = useState<RoutePoint>({latitude:39.5,longitude:-98.35});
  const [editingName, setEditingName] = useState(state.present.name);
  const draft=state.present;
  const cleanGeometry=draft.routeFresh && draft.route ? draft.route.geometry : [];
  const mapAction=(action:'start'|'end'|'waypoint',point:RoutePoint)=>{
    setState(current=>action==='waypoint'?addRouteWaypoint(current,point):setRouteEndpoint(current,action,point));
    setMode('pan');
  };
  return <View style={styles.root}>
    <Text accessibilityRole="header" style={styles.title}>Route Builder</Text>
    <Text style={styles.note}>Edit a route draft on the interactive map. Only a verified routing provider can calculate road/trail geometry, distance, surface and elevation. Saving and attaching to Training are unavailable until the approved V2 route service is connected.</Text>
    <View style={styles.row}>
      <TextInput accessibilityLabel="Route name" value={editingName}
        onChangeText={setEditingName} maxLength={120} style={styles.input}
        placeholder="Route name" placeholderTextColor={colors.mutedText}/>
      <Pressable accessibilityRole="button" style={styles.button}
        onPress={()=>setState(current=>renameRoute(current,editingName))}>
        <Text style={styles.buttonText}>Rename</Text>
      </Pressable>
    </View>
    <View style={styles.row}>
      {sports.map(s=><Pressable key={s.key} accessibilityRole="button"
        accessibilityState={{selected:draft.sport===s.key}}
        onPress={()=>setState(createManualRouteEditor({sport:s.key,name:draft.name}))}
        style={[styles.chip,draft.sport===s.key&&styles.active]}>
        <Text style={styles.buttonText}>{s.label}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.label}>Route type</Text>
    <View style={styles.row}>
      {shapes.map(s=><Pressable key={s.key} accessibilityRole="button"
        accessibilityState={{selected:draft.shape===s.key}}
        onPress={()=>setState(current=>setRouteShape(current,s.key))}
        style={[styles.chip,draft.shape===s.key&&styles.active]}>
        <Text style={styles.buttonText}>{s.label}</Text>
      </Pressable>)}
    </View>
    <Text style={styles.label}>Map tools</Text>
    <View style={styles.row}>
      {(['pan','start','end','waypoint','freehand'] as const).map(key=><Pressable key={key}
        accessibilityRole="button" accessibilityState={{selected:mode===key}}
        onPress={()=>setMode(key)}
        style={[styles.chip,mode===key&&styles.active]}>
        <Text style={styles.buttonText}>{key==='waypoint'?'Point':key==='freehand'?'Draw':key[0].toUpperCase()+key.slice(1)}</Text>
      </Pressable>)}
    </View>
    <RouteMapCanvas mode={mode} center={center} onCenterChange={setCenter}
      geometry={cleanGeometry} pendingTrace={draft.pendingFreehandTrace}
      start={draft.start} end={draft.end} waypoints={draft.waypoints}
      onMapPoint={mapAction} onMoveStart={point=>setState(current=>setRouteEndpoint(current,'start',point))}
      onMoveEnd={point=>setState(current=>setRouteEndpoint(current,'end',point))}
      onMoveWaypoint={(id,point)=>setState(current=>moveRouteWaypoint(current,id,point))}
      onFreehand={trace=>setState(current=>shapeRouteWithFreehand(current,trace))}/>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" disabled={!state.undo.length}
        onPress={()=>setState(undoRouteEdit)} style={styles.button}><Text style={styles.buttonText}>Undo</Text></Pressable>
      <Pressable accessibilityRole="button" disabled={!state.redo.length}
        onPress={()=>setState(redoRouteEdit)} style={styles.button}><Text style={styles.buttonText}>Redo</Text></Pressable>
      <Pressable accessibilityRole="button" onPress={()=>{
        setState(createManualRouteEditor({sport:draft.sport,shape:draft.shape,name:'Untitled Route'}));
        setEditingName('Untitled Route');setMode('pan');
      }} style={styles.button}><Text style={styles.buttonText}>New Draft</Text></Pressable>
    </View>
    <Text style={styles.note}>Draft: {draft.start?'Start set':'Set start'} · {draft.end?'End set':'Set end'} · {draft.waypoints.length} waypoint(s)</Text>
    {draft.waypoints.map((w,i)=><View style={styles.waypoint} key={w.id}>
      <Text style={styles.note}>Point {i+1}: {w.point.latitude.toFixed(4)}, {w.point.longitude.toFixed(4)}</Text>
      <View style={styles.row}>
        <Pressable accessibilityRole="button" disabled={i===0} onPress={()=>setState(s=>reorderRouteWaypoint(s,w.id,i-1))} style={styles.button}><Text style={styles.buttonText}>↑</Text></Pressable>
        <Pressable accessibilityRole="button" disabled={i===draft.waypoints.length-1} onPress={()=>setState(s=>reorderRouteWaypoint(s,w.id,i+1))} style={styles.button}><Text style={styles.buttonText}>↓</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={()=>setState(s=>deleteRouteWaypoint(s,w.id))} style={styles.button}><Text style={styles.buttonText}>Remove</Text></Pressable>
      </View>
    </View>)}
    <Text style={styles.note}>Route measurement: {draft.routeFresh && draft.route
      ? `${(draft.route.distanceMeters/1000).toFixed(2)} km · ${draft.route.provider.provider} (verified)`
      : 'Not calculated — map changes invalidate earlier measurements.'}</Text>
    <Text style={styles.note}>This draft is not saved or synced. Back or account switching discards it. Provider rerouting, drafts, Coach proposals, saved routes and workout attachment require reviewed V2 services.</Text>
  </View>;
}
const styles=StyleSheet.create({
  root:{gap:12},title:{fontSize:20,fontWeight:'900',color:colors.warmWhite},
  note:{fontSize:12,lineHeight:19,color:colors.mutedText},label:{fontSize:13,fontWeight:'800',color:colors.goldSoft},
  row:{flexDirection:'row',gap:6,flexWrap:'wrap',alignItems:'center'},
  input:{borderWidth:1,borderColor:colors.border,borderRadius:8,color:colors.warmWhite,minHeight:44,paddingHorizontal:10,flexGrow:1,minWidth:160},
  chip:{borderWidth:1,borderColor:colors.border,borderRadius:8,paddingHorizontal:10,minHeight:44,justifyContent:'center'},
  active:{borderColor:colors.gold,backgroundColor:colors.surfaceRaised},
  button:{borderColor:colors.border,borderWidth:1,borderRadius:8,minHeight:44,paddingHorizontal:12,justifyContent:'center'},
  buttonText:{fontSize:12,fontWeight:'800',color:colors.goldSoft},
  waypoint:{borderBottomColor:colors.border,borderBottomWidth:1,paddingVertical:8,gap:6},
});
