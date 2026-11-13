import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Image,PanResponder,Pressable,StyleSheet,Text,View,type LayoutChangeEvent} from 'react-native';
import type {RoutePoint,RouteWaypoint} from './trainingRouteEditor';
import { colors as v2Colors } from '../../../theme/tokens';
const colors = { ...v2Colors, black: v2Colors.background, white: v2Colors.warmWhite, text: v2Colors.warmWhite, textMuted: v2Colors.mutedText };
const radius = { lg: 14, sm: 8 };
const spacing = { xs: 8 };
/** Tile URLs must be reviewed and licensed for V2 before this is configured. */
const tileTemplate = process.env.EXPO_PUBLIC_V2_ROUTE_TILE_URL_TEMPLATE?.trim() ?? '';
function tileUrl(z:number,x:number,y:number):string|null {
 if (!/^https:\/\//i.test(tileTemplate) || !tileTemplate.includes('{z}') || !tileTemplate.includes('{x}') || !tileTemplate.includes('{y}')) return null;
 return tileTemplate.replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(y));
}

const TILE=256,MIN_ZOOM=3,MAX_ZOOM=18;
type Mode='pan'|'start'|'end'|'waypoint'|'freehand';
type Size={width:number;height:number};

type Props={
 center:RoutePoint;
 zoom?:number;
 mode:Mode;
 geometry:RoutePoint[];
 pendingTrace?:RoutePoint[]|null;
 start:RoutePoint|null;
 end:RoutePoint|null;
 waypoints:RouteWaypoint[];
 onCenterChange?:(point:RoutePoint)=>void;
 onMapPoint:(mode:Exclude<Mode,'pan'|'freehand'>,point:RoutePoint)=>void;
 onMoveStart:(point:RoutePoint)=>void;
 onMoveEnd:(point:RoutePoint)=>void;
 onMoveWaypoint:(id:string,point:RoutePoint)=>void;
 onFreehand:(trace:RoutePoint[])=>void;
};

function clamp(v:number,min:number,max:number){return Math.min(max,Math.max(min,v));}
function project(point:RoutePoint,zoom:number){const scale=TILE*2**zoom,x=(point.longitude+180)/360*scale,lat=clamp(point.latitude,-85.05112878,85.05112878)*Math.PI/180,y=(1-Math.log(Math.tan(lat)+1/Math.cos(lat))/Math.PI)/2*scale;return{x,y};}
function unproject(x:number,y:number,zoom:number):RoutePoint{const scale=TILE*2**zoom,longitude=x/scale*360-180,n=Math.PI-2*Math.PI*y/scale,latitude=180/Math.PI*Math.atan(Math.sinh(n));return{latitude:clamp(latitude,-85.05112878,85.05112878),longitude:((longitude+540)%360)-180};}
function screen(point:RoutePoint,center:RoutePoint,zoom:number,size:Size){const a=project(point,zoom),c=project(center,zoom);return{x:size.width/2+a.x-c.x,y:size.height/2+a.y-c.y};}
function pointAt(x:number,y:number,center:RoutePoint,zoom:number,size:Size){const c=project(center,zoom);return unproject(c.x+x-size.width/2,c.y+y-size.height/2,zoom);}
function tileKey(x:number,y:number,z:number){const n=2**z,wrapped=((x%n)+n)%n;return{key:`${z}/${wrapped}/${y}`,x:wrapped,y,z};}
function simplify(points:RoutePoint[],max=320){if(points.length<=max)return points;const step=Math.ceil(points.length/max),out=points.filter((_,i)=>i%step===0);if(out.at(-1)!==points.at(-1))out.push(points.at(-1)!);return out;}

export function RouteMapCanvas({center,zoom:initialZoom=13,mode,geometry,pendingTrace,start,end,waypoints,onCenterChange,onMapPoint,onMoveStart,onMoveEnd,onMoveWaypoint,onFreehand}:Props){
 const [size,setSize]=useState<Size>({width:0,height:360}),[zoom,setZoom]=useState(clamp(initialZoom,MIN_ZOOM,MAX_ZOOM)),[viewCenter,setViewCenter]=useState(center);
 const panStart=useRef<{center:RoutePoint;x:number;y:number}|null>(null),freehand=useRef<RoutePoint[]>([]);
 useEffect(()=>{setViewCenter(center)},[center.latitude,center.longitude]);
 const onLayout=(e:LayoutChangeEvent)=>{const {width,height}=e.nativeEvent.layout;if(width>0&&height>0)setSize({width,height});};
 const tiles=useMemo(()=>{if(!size.width)return[];const c=project(viewCenter,zoom),left=c.x-size.width/2,top=c.y-size.height/2,right=c.x+size.width/2,bottom=c.y+size.height/2,minX=Math.floor(left/TILE)-1,maxX=Math.floor(right/TILE)+1,minY=Math.max(0,Math.floor(top/TILE)-1),maxY=Math.min(2**zoom-1,Math.floor(bottom/TILE)+1),out:any[]=[];for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const t=tileKey(x,y,zoom);out.push({...t,left:x*TILE-left,top:y*TILE-top});}return out;},[viewCenter.latitude,viewCenter.longitude,zoom,size.width,size.height]);
 const gesture=useMemo(()=>PanResponder.create({
  onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,
  onPanResponderGrant:e=>{const {locationX:x,locationY:y}=e.nativeEvent;if(mode==='freehand'){freehand.current=[pointAt(x,y,viewCenter,zoom,size)];return;}panStart.current={center:viewCenter,x,y};},
  onPanResponderMove:e=>{if(mode!=='freehand')return;const {locationX:x,locationY:y}=e.nativeEvent,p=pointAt(x,y,viewCenter,zoom,size),last=freehand.current.at(-1);if(!last||Math.abs(last.latitude-p.latitude)+Math.abs(last.longitude-p.longitude)>.00005)freehand.current.push(p);},
  onPanResponderRelease:e=>{const {locationX:x,locationY:y}=e.nativeEvent;if(mode==='freehand'){const trace=freehand.current;freehand.current=[];if(trace.length>=2)onFreehand(trace);return;}const startGesture=panStart.current;panStart.current=null;if(!startGesture)return;const moved=Math.hypot(x-startGesture.x,y-startGesture.y);if(mode==='pan'&&moved>4){const c=project(startGesture.center,zoom),next=unproject(c.x-(x-startGesture.x),c.y-(y-startGesture.y),zoom);setViewCenter(next);onCenterChange?.(next);return;}if(mode!=='pan')onMapPoint(mode,pointAt(x,y,viewCenter,zoom,size));}
 }),[viewCenter.latitude,viewCenter.longitude,zoom,size.width,size.height,mode,onCenterChange,onFreehand,onMapPoint]);
 const routePoints=simplify(geometry),tracePoints=simplify(pendingTrace??[],180);
 return <View style={styles.shell}>
  <View style={styles.map} onLayout={onLayout} {...gesture.panHandlers}>
   {tiles.map(t=>{const uri=tileUrl(t.z,t.x,t.y);return uri?<Image key={t.key} source={{uri}} style={[styles.tile,{left:t.left,top:t.top}]}/>:null;})}
   <Polyline points={routePoints} center={viewCenter} zoom={zoom} size={size} width={5}/>
   <Polyline points={tracePoints} center={viewCenter} zoom={zoom} size={size} width={2} dashed/>
   {start?<Marker label="S" point={start} center={viewCenter} zoom={zoom} size={size} onMove={onMoveStart}/>:null}
   {end?<Marker label="E" point={end} center={viewCenter} zoom={zoom} size={size} onMove={onMoveEnd}/>:null}
   {waypoints.map((w,i)=><Marker key={w.id} label={String(i+1)} point={w.point} center={viewCenter} zoom={zoom} size={size} onMove={p=>onMoveWaypoint(w.id,p)}/>) }
   {tileTemplate ? <View pointerEvents="none" style={styles.attribution}><Text style={styles.attributionText}>Map data attribution per licensed provider</Text></View> : <View pointerEvents="none" style={styles.attribution}><Text style={styles.attributionText}>Map tiles unavailable until provider approval</Text></View>}
  </View>
  <View style={styles.zoomRow}><Pressable accessibilityRole="button" style={styles.zoomButton} onPress={()=>setZoom(z=>clamp(z+1,MIN_ZOOM,MAX_ZOOM))}><Text style={styles.zoomText}>＋</Text></Pressable><Pressable accessibilityRole="button" style={styles.zoomButton} onPress={()=>setZoom(z=>clamp(z-1,MIN_ZOOM,MAX_ZOOM))}><Text style={styles.zoomText}>−</Text></Pressable><Text style={styles.modeText}>{mode==='pan'?'Pan map':mode==='freehand'?'Draw desired path':`Tap map to set ${mode}`}</Text></View>
 </View>;
}

function Polyline({points,center,zoom,size,width,dashed=false}:{points:RoutePoint[];center:RoutePoint;zoom:number;size:Size;width:number;dashed?:boolean}){if(points.length<2)return null;const xy=points.map(p=>screen(p,center,zoom,size));return <>{xy.slice(1).map((b,i)=>{const a=xy[i],dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);if(!Number.isFinite(length)||length<1)return null;const angle=Math.atan2(dy,dx);return <View key={`${i}-${a.x.toFixed(1)}-${a.y.toFixed(1)}`} pointerEvents="none" style={[styles.line,{left:(a.x+b.x)/2-length/2,top:(a.y+b.y)/2-width/2,width:length,height:width,opacity:dashed?.55:1,transform:[{rotate:`${angle}rad`}]}]}/>})}</>}
function Marker({label,point,center,zoom,size,onMove}:{label:string;point:RoutePoint;center:RoutePoint;zoom:number;size:Size;onMove:(point:RoutePoint)=>void}){const p=screen(point,center,zoom,size),origin=useRef<{x:number;y:number}|null>(null),drag=useMemo(()=>PanResponder.create({onStartShouldSetPanResponder:()=>true,onMoveShouldSetPanResponder:()=>true,onPanResponderGrant:()=>{origin.current={x:p.x,y:p.y}},onPanResponderRelease:(_,g)=>{const o=origin.current;origin.current=null;if(o)onMove(pointAt(o.x+g.dx,o.y+g.dy,center,zoom,size));}}),[p.x,p.y,center.latitude,center.longitude,zoom,size.width,size.height,onMove]);return <View {...drag.panHandlers} style={[styles.markerTouch,{left:p.x-22,top:p.y-22}]}><View style={styles.marker}><Text style={styles.markerText}>{label}</Text></View></View>}

const styles=StyleSheet.create({shell:{gap:spacing.xs},map:{height:360,overflow:'hidden',borderRadius:radius.lg,borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface},tile:{position:'absolute',width:TILE,height:TILE},line:{position:'absolute',backgroundColor:colors.gold,borderRadius:999},markerTouch:{position:'absolute',width:44,height:44,alignItems:'center',justifyContent:'center'},marker:{width:30,height:30,borderRadius:15,alignItems:'center',justifyContent:'center',backgroundColor:colors.black,borderWidth:3,borderColor:colors.gold},markerText:{color:colors.white,fontWeight:'900',fontSize:11},zoomRow:{flexDirection:'row',alignItems:'center',gap:spacing.xs},zoomButton:{width:42,height:42,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:colors.border,borderRadius:radius.sm,backgroundColor:colors.surfaceRaised},zoomText:{color:colors.text,fontSize:22,fontWeight:'900'},modeText:{color:colors.textMuted,fontSize:11,flex:1},attribution:{position:'absolute',right:4,bottom:4,backgroundColor:'rgba(0,0,0,.65)',paddingHorizontal:5,paddingVertical:2,borderRadius:4},attributionText:{color:'#fff',fontSize:9}});
