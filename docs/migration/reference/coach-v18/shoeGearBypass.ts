export type ShoeGearBypassResult={answer:string;routeKey:string};

type ShoeRow={id:string;name:string;brand:string;model:string;retired:boolean;currentMiles:number|null};
type ShoeLookupIntent="inventory"|"mileage"|"status";

const normalize=(value:string)=>String(value||"").toLowerCase().replace(/\s+/g," ").trim();
const SHOE_TERMS=/\b(shoe|shoes|footwear|sneaker|sneakers)\b/;
const ADVISORY_TERMS=/\b(should|recommend|replace|replacement|retire|retirement|buy|purchase|best|wear|use|rotation|safe|injury|injuries|too many|too much|enough|good|bad|why|when)\b/;

const numeric=(value:unknown):number|null=>{const n=Number(value);return value===null||value===undefined||value===""||!Number.isFinite(n)||n<0?null:n;};
const text=(value:unknown)=>String(value??"").trim();

export const shoeGearLookupIntent=(message:string):ShoeLookupIntent|null=>{
  const m=normalize(message);
  if(!SHOE_TERMS.test(m)||ADVISORY_TERMS.test(m))return null;
  if(/\b(miles?|mileage)\b/.test(m))return"mileage";
  if(/\b(active|retired|status)\b/.test(m))return"status";
  if(/^(what|which|show|list|do i have|what do i have).*(shoe|shoes|footwear|sneaker|sneakers)/.test(m)||/\b(shoe|shoes)\b.*\b(have|own)\b/.test(m))return"inventory";
  return null;
};

const compactRows=(gear:any):ShoeRow[]=>{
  const rows=[
    ...(Array.isArray(gear?.active)?gear.active.map((row:any)=>({...row,__retired:false})):[]),
    ...(Array.isArray(gear?.retired)?gear.retired.map((row:any)=>({...row,__retired:true})):[]),
  ];
  return rows.filter((row:any)=>String(row?.gear_type)==="shoes"&&text(row?.id)).map((row:any)=>({
    id:text(row.id),name:text(row.name),brand:text(row.brand),model:text(row.model),retired:Boolean(row.__retired),currentMiles:numeric(row.current_miles),
  }));
};

const label=(row:ShoeRow)=>row.name||[row.brand,row.model].filter(Boolean).join(" ")||row.model||"Unnamed shoes";
const mileageText=(row:ShoeRow)=>row.currentMiles===null?"mileage unknown":`${row.currentMiles.toFixed(row.currentMiles<10?2:1).replace(/\.0$/,"")} miles`;
const matchingShoes=(message:string,rows:ShoeRow[])=>{
  const m=normalize(message);
  const matches=rows.filter(row=>{
    const candidates=[row.name,row.model,[row.brand,row.model].filter(Boolean).join(" ")].map(normalize).filter(value=>value.length>=2);
    return candidates.some(value=>m.includes(value));
  });
  return matches.length===1?matches:[];
};

export const resolveShoeGearBypassFromGear=({message,gear}:{message:string;gear:any}):ShoeGearBypassResult|null=>{
  const intent=shoeGearLookupIntent(message);if(!intent)return null;
  const rows=compactRows(gear);if(!rows.length)return null;
  const specific=matchingShoes(message,rows);
  if(intent==="inventory"){
    const active=rows.filter(row=>!row.retired).map(label),retired=rows.filter(row=>row.retired).map(label);
    const parts:string[]=[];
    if(active.length)parts.push(`Active shoes: ${active.join(", ")}.`);
    if(retired.length)parts.push(`Retired shoes: ${retired.join(", ")}.`);
    return parts.length?{answer:parts.join(" "),routeKey:"gear_shoe_inventory"}:null;
  }
  if(intent==="mileage"){
    const targets=specific.length?specific:rows.filter(row=>!row.retired);
    if(!targets.length)return null;
    return{answer:targets.map(row=>`${label(row)}: ${mileageText(row)}.`).join(" "),routeKey:"gear_shoe_mileage"};
  }
  if(!specific.length)return null;
  const row=specific[0];
  return{answer:`${label(row)} is ${row.retired?"retired":"active"}.`,routeKey:"gear_shoe_status"};
};
