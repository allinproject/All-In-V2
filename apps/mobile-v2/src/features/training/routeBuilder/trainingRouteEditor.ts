import type {RouteShape,RouteSport,ValidatedTrainingRoute} from './trainingRouteTypes';

export type RoutePoint={latitude:number;longitude:number};
export type RouteWaypoint={id:string;point:RoutePoint};
export type RouteOrigin='manual'|'coach';

export type ManualRouteDraft={
 routeId:string|null;
 name:string;
 sport:RouteSport;
 shape:Exclude<RouteShape,'unknown'>;
 start:RoutePoint|null;
 end:RoutePoint|null;
 waypoints:RouteWaypoint[];
 route:ValidatedTrainingRoute|null;
 routeFresh:boolean;
 origin:RouteOrigin;
 derivedFromRouteId:string|null;
 favorite:boolean;
 pendingFreehandTrace:RoutePoint[]|null;
 lastMaterialChange:string|null;
};

export type ManualRouteEditorState={present:ManualRouteDraft;undo:ManualRouteDraft[];redo:ManualRouteDraft[]};

export type AuthoritativeRouteEditRequest={
 sourcePolicy:'routing_map_provider_only';
 sport:RouteSport;
 shape:Exclude<RouteShape,'unknown'>;
 start:RoutePoint;
 end:RoutePoint;
 waypoints:RouteWaypoint[];
 freehandTrace:RoutePoint[]|null;
 baseProviderRouteId:string|null;
 rerouteScope:'edited_segment_when_supported';
 allowArbitraryGeometry:false;
};

export type SavedTrainingRouteRecord={
 id:string;
 identity:'canonical_training_route';
 name:string;
 sport:RouteSport;
 shape:Exclude<RouteShape,'unknown'>;
 favorite:boolean;
 origin:RouteOrigin;
 derivedFromRouteId:string|null;
 route:ValidatedTrainingRoute;
 createdAt:string;
 updatedAt:string;
 lastUsedAt:string|null;
};

export type RouteSaveCommand={
 action:'create_canonical_training_route'|'update_canonical_training_route';
 routeId:string|null;
 name:string;
 sport:RouteSport;
 shape:Exclude<RouteShape,'unknown'>;
 favorite:boolean;
 origin:RouteOrigin;
 derivedFromRouteId:string|null;
 route:ValidatedTrainingRoute;
 requiresExplicitSave:true;
};

export type RouteLibrarySections={saved:SavedTrainingRouteRecord[];recent:SavedTrainingRouteRecord[];favorites:SavedTrainingRouteRecord[];coachSuggestions:ValidatedTrainingRoute[]};

function clone<T>(value:T):T{return JSON.parse(JSON.stringify(value)) as T;}
function finitePoint(value:RoutePoint|null|undefined):value is RoutePoint{return Boolean(value&&Number.isFinite(value.latitude)&&Number.isFinite(value.longitude)&&Math.abs(value.latitude)<=90&&Math.abs(value.longitude)<=180);}
function clean(value:string,max:number){return value.replace(/[\r\n\t]+/g,' ').trim().slice(0,max);}
function pushHistory(state:ManualRouteEditorState,next:ManualRouteDraft):ManualRouteEditorState{return {present:next,undo:[...state.undo,clone(state.present)].slice(-50),redo:[]};}
function markNeedsReroute(draft:ManualRouteDraft):ManualRouteDraft{return {...draft,routeFresh:false,lastMaterialChange:null};}
function waypointId(existing:RouteWaypoint[]){const used=new Set(existing.map(x=>x.id));for(let i=1;i<10000;i++){const id=`wp-${i}`;if(!used.has(id))return id;}return `wp-${Date.now()}`;}

export function createManualRouteEditor(input:{sport:RouteSport;shape?:Exclude<RouteShape,'unknown'>;name?:string}):ManualRouteEditorState{
 return {present:{routeId:null,name:clean(input.name??'Untitled Route',120)||'Untitled Route',sport:input.sport,shape:input.shape??'loop',start:null,end:null,waypoints:[],route:null,routeFresh:false,origin:'manual',derivedFromRouteId:null,favorite:false,pendingFreehandTrace:null,lastMaterialChange:null},undo:[],redo:[]};
}

export function openSavedRouteInEditor(route:SavedTrainingRouteRecord):ManualRouteEditorState{
 const start=route.route.geometry[0]??null,end=route.route.geometry.at(-1)??null;
 return {present:{routeId:route.id,name:route.name,sport:route.sport,shape:route.shape,start,end,waypoints:[],route:route.route,routeFresh:true,origin:route.origin,derivedFromRouteId:route.derivedFromRouteId,favorite:route.favorite,pendingFreehandTrace:null,lastMaterialChange:null},undo:[],redo:[]};
}

export function openCoachRouteInEditor(route:ValidatedTrainingRoute,input:{sport:RouteSport;name?:string}):ManualRouteEditorState{
 const shape=route.shape==='unknown'?'point_to_point':route.shape,start=route.geometry[0]??null,end=route.geometry.at(-1)??null;
 return {present:{routeId:null,name:clean(input.name??'Coach Route',120)||'Coach Route',sport:input.sport,shape,start,end,waypoints:[],route,routeFresh:isCanonicalRoute(route),origin:'coach',derivedFromRouteId:null,favorite:false,pendingFreehandTrace:null,lastMaterialChange:null},undo:[],redo:[]};
}

export function setRouteEndpoint(state:ManualRouteEditorState,role:'start'|'end',point:RoutePoint):ManualRouteEditorState{
 if(!finitePoint(point))return state;return pushHistory(state,markNeedsReroute({...state.present,[role]:point,pendingFreehandTrace:null}));
}
export function addRouteWaypoint(state:ManualRouteEditorState,point:RoutePoint,index=state.present.waypoints.length):ManualRouteEditorState{
 if(!finitePoint(point))return state;const waypoints=[...state.present.waypoints],at=Math.max(0,Math.min(waypoints.length,index));waypoints.splice(at,0,{id:waypointId(waypoints),point});return pushHistory(state,markNeedsReroute({...state.present,waypoints,pendingFreehandTrace:null}));
}
export function moveRouteWaypoint(state:ManualRouteEditorState,id:string,point:RoutePoint):ManualRouteEditorState{
 if(!finitePoint(point)||!state.present.waypoints.some(x=>x.id===id))return state;return pushHistory(state,markNeedsReroute({...state.present,waypoints:state.present.waypoints.map(x=>x.id===id?{...x,point}:x),pendingFreehandTrace:null}));
}
export function reorderRouteWaypoint(state:ManualRouteEditorState,id:string,toIndex:number):ManualRouteEditorState{
 const from=state.present.waypoints.findIndex(x=>x.id===id);if(from<0||!Number.isInteger(toIndex))return state;const waypoints=[...state.present.waypoints],item=waypoints.splice(from,1)[0],at=Math.max(0,Math.min(waypoints.length,toIndex));waypoints.splice(at,0,item);return pushHistory(state,markNeedsReroute({...state.present,waypoints,pendingFreehandTrace:null}));
}
export function deleteRouteWaypoint(state:ManualRouteEditorState,id:string):ManualRouteEditorState{
 if(!state.present.waypoints.some(x=>x.id===id))return state;return pushHistory(state,markNeedsReroute({...state.present,waypoints:state.present.waypoints.filter(x=>x.id!==id),pendingFreehandTrace:null}));
}
export function setRouteShape(state:ManualRouteEditorState,shape:Exclude<RouteShape,'unknown'>):ManualRouteEditorState{
 if(state.present.shape===shape)return state;return pushHistory(state,markNeedsReroute({...state.present,shape,pendingFreehandTrace:null}));
}
export function shapeRouteWithFreehand(state:ManualRouteEditorState,trace:RoutePoint[]):ManualRouteEditorState{
 const valid=trace.filter(finitePoint);if(valid.length<2)return state;return pushHistory(state,markNeedsReroute({...state.present,pendingFreehandTrace:valid}));
}

export function buildAuthoritativeRouteEditRequest(state:ManualRouteEditorState):AuthoritativeRouteEditRequest|null{
 const draft=state.present;if(!finitePoint(draft.start)||!finitePoint(draft.end))return null;
 return {sourcePolicy:'routing_map_provider_only',sport:draft.sport,shape:draft.shape,start:draft.start,end:draft.end,waypoints:clone(draft.waypoints),freehandTrace:clone(draft.pendingFreehandTrace),baseProviderRouteId:draft.route?.provider.providerRouteId??null,rerouteScope:'edited_segment_when_supported',allowArbitraryGeometry:false};
}

export function acceptAuthoritativeRoute(state:ManualRouteEditorState,route:ValidatedTrainingRoute):ManualRouteEditorState{
 if(!isCanonicalRoute(route))return state;
 if(route.shape!=='unknown'&&route.shape!==state.present.shape)return state;
 const lastMaterialChange=describeMaterialChange(state.present.route,route);
 return {...state,present:{...state.present,route,routeFresh:true,pendingFreehandTrace:null,lastMaterialChange}};
}

export function undoRouteEdit(state:ManualRouteEditorState):ManualRouteEditorState{
 const previous=state.undo.at(-1);if(!previous)return state;return {present:clone(previous),undo:state.undo.slice(0,-1),redo:[clone(state.present),...state.redo].slice(0,50)};
}
export function redoRouteEdit(state:ManualRouteEditorState):ManualRouteEditorState{
 const next=state.redo[0];if(!next)return state;return {present:clone(next),undo:[...state.undo,clone(state.present)].slice(-50),redo:state.redo.slice(1)};
}
export function renameRoute(state:ManualRouteEditorState,name:string):ManualRouteEditorState{const value=clean(name,120);if(!value||value===state.present.name)return state;return pushHistory(state,{...state.present,name:value});}
export function setRouteFavorite(state:ManualRouteEditorState,favorite:boolean):ManualRouteEditorState{if(favorite===state.present.favorite)return state;return pushHistory(state,{...state.present,favorite});}
export function duplicateRouteDraft(state:ManualRouteEditorState):ManualRouteEditorState{return {present:{...clone(state.present),routeId:null,name:`${state.present.name} Copy`.slice(0,120),derivedFromRouteId:state.present.routeId,origin:'manual'},undo:[],redo:[]};}

export function buildRouteSaveCommand(state:ManualRouteEditorState):RouteSaveCommand|null{
 const draft=state.present;if(!draft.routeFresh||!draft.route||!isCanonicalRoute(draft.route)||!finitePoint(draft.start)||!finitePoint(draft.end))return null;
 return {action:draft.routeId?'update_canonical_training_route':'create_canonical_training_route',routeId:draft.routeId,name:draft.name,sport:draft.sport,shape:draft.shape,favorite:draft.favorite,origin:draft.origin,derivedFromRouteId:draft.derivedFromRouteId,route:draft.route,requiresExplicitSave:true};
}

export function buildRouteLibrarySections(savedRoutes:SavedTrainingRouteRecord[],coachSuggestions:ValidatedTrainingRoute[],recentLimit=10):RouteLibrarySections{
 const saved=[...savedRoutes],favorites=saved.filter(x=>x.favorite),recent=saved.filter(x=>x.lastUsedAt).sort((a,b)=>Date.parse(b.lastUsedAt!)-Date.parse(a.lastUsedAt!)).slice(0,Math.max(0,recentLimit));return {saved,recent,favorites,coachSuggestions:[...coachSuggestions]};
}

export function serializeRecoverableRouteDraft(state:ManualRouteEditorState):string{return JSON.stringify({version:1,draft:state.present});}
export function restoreRecoverableRouteDraft(raw:string):ManualRouteEditorState|null{
 try{const parsed=JSON.parse(raw),draft=parsed?.draft as ManualRouteDraft;if(parsed?.version!==1||!draft||!['run','ride','hike','ruck'].includes(draft.sport)||!['loop','out_and_back','point_to_point'].includes(draft.shape)||!(draft.start==null||finitePoint(draft.start))||!(draft.end==null||finitePoint(draft.end))||!Array.isArray(draft.waypoints)||draft.waypoints.some(x=>!x||typeof x.id!=='string'||!finitePoint(x.point)))return null;return {present:draft,undo:[],redo:[]};}catch{return null;}
}

export function isCanonicalRoute(route:ValidatedTrainingRoute|null|undefined):route is ValidatedTrainingRoute{
 return Boolean(route&&route.provider?.kind==='routing_map_provider'&&clean(route.provider.provider,120)&&clean(route.provider.providerRouteId,180)&&Array.isArray(route.geometry)&&route.geometry.length>=2&&route.geometry.every(finitePoint)&&Number.isFinite(route.distanceMeters)&&route.distanceMeters>0&&Array.isArray(route.segments)&&route.segments.length>0&&route.segments.every(segment=>segment.connected===true&&segment.routable===true&&segment.access==='public'&&segment.sportAccess==='allowed'&&segment.closure==='open'));
}
function describeMaterialChange(previous:ValidatedTrainingRoute|null,next:ValidatedTrainingRoute):string|null{
 if(!previous)return null;const distancePct=Math.abs(next.distanceMeters-previous.distanceMeters)/Math.max(1,previous.distanceMeters);const facilityBefore=previous.facilitySummary.map(x=>x.facilityType).sort().join(','),facilityAfter=next.facilitySummary.map(x=>x.facilityType).sort().join(',');if(distancePct>=0.03)return `Authoritative reroute changed distance by ${Math.round(distancePct*100)}%.`;if(facilityBefore!==facilityAfter)return 'Authoritative reroute changed the facility mix.';if(previous.provider.providerRouteId!==next.provider.providerRouteId)return 'Authoritative reroute changed route geometry.';return null;
}
