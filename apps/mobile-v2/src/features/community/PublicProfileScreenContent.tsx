/** ALL-244 Public Profile UI; injected certified reader result only.
 * This component does NOT perform network reads or offer unwired follow/block
 * buttons. Navigation, ownership, RLS and mutation require the Community owner.
 */
import {StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens';
import {profileAvatarInitials,profileIdentityDisplay} from '../profile/profileIdentityPresentation';
import type {PublicProfileScreenRead} from './publicProfileOwnerRead';

export function PublicProfileScreenContent({result}:{result:PublicProfileScreenRead|null}){
 if(result===null)return <View style={styles.card}>
  <Text style={styles.title}>Community Profile</Text>
  <Text style={styles.muted}>Profile details are unavailable until the Community connection is ready.</Text>
 </View>;
 if(result.status==='blocked')return <View style={styles.card}>
  <Text style={styles.title}>Profile unavailable</Text>
  <Text style={styles.muted}>This profile cannot be viewed.</Text>
 </View>;
 const info=result.profile;
 return <View style={styles.page}>
  <View style={styles.card}>
   <View style={styles.identity}>
    <View style={styles.avatar}><Text style={styles.initials}>{profileAvatarInitials(result.displayName)}</Text></View>
    <View style={styles.identityName}>
     <Text style={styles.title}>{profileIdentityDisplay(result.displayName)}</Text>
     <Text style={styles.muted}>{info.label==='private_profile'?'Private profile':
      info.label==='follow_request_pending'?'Follow request pending':
      info.label==='own_profile'?'Your Community profile':'Community athlete'}</Text>
    </View>
   </View>
   {info.visibleGeneralArea?<Text style={styles.muted}>General area: {info.visibleGeneralArea}</Text>:null}
  </View>
  <View style={styles.card}>
   <Text style={styles.section}>Posts</Text>
   {!result.posts.length?<Text style={styles.muted}>
    {info.label==='private_profile'||info.label==='follow_request_pending'?
     'Posts are visible only to approved followers.':'No posts are available to this viewer.'}
   </Text>:result.posts.map(post=><View key={post.id} style={styles.item}>
    <Text style={styles.body}>{post.title}</Text>
    <Text style={styles.muted}>{post.audience==='followers'?'Followers only':post.audience==='private'?'Only me':'Shared post'}</Text>
   </View>)}
  </View>
  <View style={styles.card}>
   <Text style={styles.section}>Events</Text>
   {!result.races.length?<Text style={styles.muted}>No event participation is available to this viewer.</Text>
    :result.races.map(race=><View key={race.id} style={styles.item}><Text style={styles.body}>{race.eventName}</Text></View>)}
  </View>
 </View>;
}
const styles=StyleSheet.create({
 page:{gap:14},
 card:{backgroundColor:colors.surface,borderWidth:1,borderColor:colors.border,
  borderRadius:16,padding:18,gap:12},
 identity:{flexDirection:'row',alignItems:'center',gap:12},
 identityName:{flex:1,gap:4},
 avatar:{width:64,height:64,borderRadius:32,borderWidth:1,borderColor:colors.gold,
  backgroundColor:colors.surfaceRaised,alignItems:'center',justifyContent:'center'},
 initials:{color:colors.goldSoft,fontSize:21,fontWeight:'800'},
 title:{color:colors.warmWhite,fontSize:19,fontWeight:'800'},
 section:{color:colors.warmWhite,fontSize:17,fontWeight:'800'},
 body:{color:colors.warmWhite,fontSize:14,fontWeight:'600'},
 muted:{color:colors.mutedText,fontSize:12,lineHeight:19},
 item:{borderTopWidth:1,borderTopColor:colors.border,paddingTop:12,gap:4},
});
