/** ALL-243: display-only layout state for the V1-standard Overview and Details tabs.
 * Preferences live in the existing app_preferences.completed_activity_layouts owner.
 * Metric definitions and source-backed values remain owned by canonical Completed Activity.
 */
export type CompletedActivityPane = 'overview'|'details';
export type LayoutMetric = {key:string;label:string;required?:boolean};
export type MetricLayout = {order:string[];pinned:string[];hidden:string[]};
export type CompletedActivityLayouts = Record<string,MetricLayout>;
export const EMPTY_LAYOUT:MetricLayout={order:[],pinned:[],hidden:[]};
const object=(x:unknown):Record<string,unknown>=>x!==null&&typeof x==='object'&&!Array.isArray(x)?x as Record<string,unknown>:{};
const validKey=(key:string)=>key.length>=1&&key.length<=120&&/^[a-z0-9][a-z0-9._:-]*$/i.test(key);
const keys=(raw:unknown):string[]=>
 Array.isArray(raw)?[...new Set(raw.filter((x):x is string=>typeof x==='string'&&validKey(x)))].slice(0,300):[];
export function layoutScope(sport:string,pane:CompletedActivityPane):string{
 if(!validKey(sport))throw new Error('Invalid sport identity.');
 if(pane!=='overview'&&pane!=='details')throw new Error('Invalid completed activity tab.');
 return sport+':'+pane;
}
export function readCompletedActivityLayouts(settings:unknown):CompletedActivityLayouts {
 const raw=object(object(object(settings).app_preferences).completed_activity_layouts);
 const out:CompletedActivityLayouts={};
 for(const [scope,value] of Object.entries(raw).slice(0,200)){
  if(!/^[a-z0-9._-]+:(overview|details)$/i.test(scope)||scope.length>150)continue;
  const r=object(value);
  out[scope]={order:keys(r.order),pinned:keys(r.pinned),hidden:keys(r.hidden)};
 }
 return out;
}
export function completedActivityLayoutPatch(layouts:CompletedActivityLayouts){
 if(Object.keys(layouts).length>200)throw new Error('Too many customized activity layouts.');
 return {completed_activity_layouts:layouts};
}
export function readMetricLayout(layouts:CompletedActivityLayouts,sport:string,pane:CompletedActivityPane):MetricLayout{
 const l=layouts[layoutScope(sport,pane)]??EMPTY_LAYOUT;
 return {order:[...l.order],pinned:[...l.pinned],hidden:[...l.hidden]};
}
export function updateMetricLayout(layouts:CompletedActivityLayouts,sport:string,pane:CompletedActivityPane,layout:MetricLayout):CompletedActivityLayouts{
 const scope=layoutScope(sport,pane);
 return {...layouts,[scope]:{order:keys(layout.order),pinned:keys(layout.pinned),hidden:keys(layout.hidden)}};
}
export function resetMetricLayout(layouts:CompletedActivityLayouts,sport:string,pane:CompletedActivityPane):CompletedActivityLayouts{
 const scope=layoutScope(sport,pane);
 const next={...layouts};delete next[scope];return next;
}
function known(metricKey:string,available:readonly LayoutMetric[]):LayoutMetric{
 const found=available.find(x=>x.key===metricKey);
 if(!found)throw new Error('Metric is not available for this sport and activity.');
 return found;
}
export function toggleMetricPin(layout:MetricLayout,metricKey:string,available:readonly LayoutMetric[]):MetricLayout{
 known(metricKey,available);
 const pinned=layout.pinned.includes(metricKey)?layout.pinned.filter(x=>x!==metricKey):[...layout.pinned,metricKey];
 return {...layout,pinned,hidden:layout.hidden.filter(x=>x!==metricKey)};
}
export function toggleMetricHidden(layout:MetricLayout,metricKey:string,available:readonly LayoutMetric[]):MetricLayout{
 const metric=known(metricKey,available);
 if(metric.required)throw new Error('Required safety or provenance metrics cannot be hidden.');
 const hidden=layout.hidden.includes(metricKey)?layout.hidden.filter(x=>x!==metricKey):[...layout.hidden,metricKey];
 return {...layout,hidden,pinned:layout.pinned.filter(x=>x!==metricKey)};
}
export function moveMetric(layout:MetricLayout,metricKey:string,direction:'up'|'down',available:readonly LayoutMetric[]):MetricLayout{
 known(metricKey,available);
 const order=[...new Set([...layout.order,...available.map(x=>x.key)])].filter(k=>available.some(x=>x.key===k));
 const oldIndex=order.indexOf(metricKey),newIndex=oldIndex+(direction==='up'?-1:1);
 if(newIndex<0||newIndex>=order.length)return {...layout,order};
 [order[oldIndex],order[newIndex]]=[order[newIndex],order[oldIndex]];
 return {...layout,order};
}
export function presentMetrics<T extends LayoutMetric>(available:readonly T[],layout:MetricLayout):T[]{
 const map=new Map<string,T>();
 for(const m of available)if(validKey(m.key)&&!map.has(m.key))map.set(m.key,m);
 const full=[...layout.order,...map.keys()];
 const seen=new Set<string>();
 const sorted:T[]=[];
 for(const key of full){
  if(seen.has(key))continue;
  seen.add(key);
  const metric=map.get(key);
  if(metric&&(!layout.hidden.includes(key)||metric.required))sorted.push(metric);
 }
 const pinned=new Set(layout.pinned);
 return [...sorted.filter(x=>pinned.has(x.key)),...sorted.filter(x=>!pinned.has(x.key))];
}
