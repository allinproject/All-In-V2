export type RunningEvidence={distanceMeters:number;durationSeconds:number;observedAt:string|null;source:'race'|'pr'|'workout'|'manual';evidenceId:string};
export type RunningPrediction={key:'mile'|'5k'|'10k'|'half_marathon'|'marathon';distanceMeters:number;predictedSeconds:number;confidence:'low'|'medium'|'high';evidenceId:string;basis:string};
const targets=[['mile',1609.344],['5k',5000],['10k',10000],['half_marathon',21097.5],['marathon',42195]] as const;
const good=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
export function predictRunningPerformances(rows:RunningEvidence[],now=new Date()):RunningPrediction[]{
 const evidence=rows.filter(r=>good(r.distanceMeters)&&r.distanceMeters>=800&&r.distanceMeters<=42195&&good(r.durationSeconds)&&Boolean(r.evidenceId)&&['race','pr','workout','manual'].includes(r.source)&&(!r.observedAt||(Number.isFinite(Date.parse(r.observedAt))&&Date.parse(r.observedAt)<=now.getTime())));
 return targets.map(([key,distanceMeters])=>{
  if(!evidence.length)return null;
  const sorted=[...evidence].sort((a,b)=>score(b,distanceMeters,now)-score(a,distanceMeters,now)),best=sorted[0];
  const ratio=Math.max(best.distanceMeters,distanceMeters)/Math.min(best.distanceMeters,distanceMeters),exponent=ratio>=20?1.09:ratio>=8?1.075:1.06;
  const seconds=Math.round(best.durationSeconds*Math.pow(distanceMeters/best.distanceMeters,exponent)),age=best.observedAt?(now.getTime()-Date.parse(best.observedAt))/86400000:999;
  const confidence=ratio<=2.2&&age<=90&&(best.source==='race'||best.source==='pr')?'high':ratio<=5&&age<=180?'medium':'low';
  return{key,distanceMeters,predictedSeconds:seconds,confidence,evidenceId:best.evidenceId,basis:'Based on '+best.distanceMeters+' m in '+best.durationSeconds+' s ('+best.source+')'};
 }).filter((x):x is RunningPrediction=>x!==null);
}
function score(r:RunningEvidence,target:number,now:Date){const ratio=Math.max(r.distanceMeters,target)/Math.min(r.distanceMeters,target),distance=1/Math.max(1,Math.log2(ratio+1)),age=r.observedAt?Math.max(0,(now.getTime()-Date.parse(r.observedAt))/86400000):365,recency=1/(1+age/180),source=r.source==='race'?1.08:r.source==='pr'?1.05:r.source==='workout'?.95:.9;return distance*.6+recency*.3+source*.1}
export function predictionChange(previous:number|null,current:number|null):number|null{return good(previous)&&good(current)?Math.round(previous-current):null}
