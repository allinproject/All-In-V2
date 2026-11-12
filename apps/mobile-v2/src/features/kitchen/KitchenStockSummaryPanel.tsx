import {useEffect,useState} from 'react';
import {StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens.ts';
import {supabase} from '../../lib/supabase.ts';
import {readOwnedKitchenStock,ownedKitchenStockServices,V2_KITCHEN_STOCK_READ_ENABLED,
 type OwnedKitchenStockSnapshot} from './kitchenStockOwnerClient.ts';

/** Read-only, account-scoped until the canonical Kitchen owner is deployed. */
export function KitchenStockSummaryPanel({ownerId,kind,accessReady}:{
 ownerId:string;kind:'shopping'|'pantry';accessReady:boolean;
}){
 const [stock,setStock]=useState<OwnedKitchenStockSnapshot|null>(null);
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
  let active=true;setStock(null);
  if(!V2_KITCHEN_STOCK_READ_ENABLED||!accessReady||!ownerId){
   setLoading(false);return()=>{active=false;};
  }
  setLoading(true);
  void readOwnedKitchenStock(ownedKitchenStockServices(supabase,ownerId),ownerId,
   ()=>active,true).then(v=>{
    if(active)setStock(v.status==='ready'?v.snapshot:null);
   }).catch(()=>{if(active)setStock(null);})
    .finally(()=>{if(active)setLoading(false);});
  return()=>{active=false;};
 },[ownerId,accessReady,kind]);
 if(!V2_KITCHEN_STOCK_READ_ENABLED)return <Text style={styles.note}>
  {kind==='shopping'?'Shopping is not connected yet. No list changes have been made.'
   :'Pantry is not connected yet. Existing stock is not assumed empty.'}
 </Text>;
 if(loading)return <Text style={styles.note}>Loading {kind}…</Text>;
 if(!stock)return <Text style={styles.note}>Verified {kind} information is unavailable. No data was changed.</Text>;
 if(kind==='shopping')return <View style={styles.group}>
  <Text style={styles.note}>{stock.manualShopping.length} verified manual Shopping items.
   Planned shortages are not connected until the canonical Food Plan and Pantry are joined.</Text>
  {stock.manualShopping.map(item=><View key={item.id} style={styles.item}>
   <Text style={styles.title}>{item.description}</Text>
   <Text style={styles.note}>{item.state==='in_cart'?'In cart · not purchased':'Needed'}
    {item.requestedQuantity!==null&&item.unit?' · '+item.requestedQuantity+' '+item.unit:''}</Text>
  </View>)}
 </View>;
 const locations=['pantry','fridge','freezer','spices'];
 return <View style={styles.group}>
  <Text style={styles.note}>{stock.pantryLots.length} verified Pantry lots.
   Usable availability depends on reservations, expiry and preparation state.</Text>
  {locations.map(location=>{
   const count=stock.pantryLots.filter(lot=>lot.location===location).length;
   return count?<Text key={location} style={styles.title}>{location}: {count} {count===1?'lot':'lots'}</Text>:null;
  })}
 </View>;
}
const styles=StyleSheet.create({
 group:{gap:10},note:{color:colors.goldSoft,fontSize:13,lineHeight:20},
 item:{backgroundColor:colors.surfaceRaised,borderRadius:12,padding:12,gap:4},
 title:{color:colors.warmWhite,fontWeight:'700',fontSize:14},
});
