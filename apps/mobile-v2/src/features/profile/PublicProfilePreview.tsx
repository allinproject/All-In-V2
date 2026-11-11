/** ALL-251/244 — offline visual preview ONLY.
 * Not a public route, canonical relationship reader, or social account.
 * Deliberately excludes email, source activity data and fabricated counts.
 */
import {StyleSheet,Text,View} from 'react-native';
import {colors} from '../../theme/tokens';
import {profileAvatarInitials,profileIdentityDisplay} from './profileIdentityPresentation';

export function PublicProfilePreview({draftDisplayName}:{draftDisplayName:string|null}){
 return <View style={styles.card} accessibilityLabel="Community profile preview, not published">
   <Text style={styles.title}>Community Profile Preview</Text>
   <Text style={styles.notice}>Preview only · Nothing here is published or shared.</Text>
   <View style={styles.identity}>
     <View style={styles.avatar}><Text style={styles.initials}>{profileAvatarInitials(draftDisplayName)}</Text></View>
     <View style={styles.details}>
       <Text style={styles.name}>{profileIdentityDisplay(draftDisplayName)}</Text>
       <Text style={styles.secondary}>Athlete profile</Text>
     </View>
   </View>
   <Text style={styles.secondary}>Your future public-facing page can show approved posts, followed athletes and event participation, according to your privacy settings.</Text>
   <View style={styles.rule}/>
   <Text style={styles.secondary}>Posts, followers, race visibility and account privacy are not connected to the Community backend yet. Your account email is never part of this preview.</Text>
 </View>;
}
const styles=StyleSheet.create({
 card:{borderWidth:1,borderColor:colors.border,backgroundColor:colors.surface,
  padding:18,borderRadius:18,gap:12},
 title:{fontSize:18,fontWeight:'800',color:colors.warmWhite},
 notice:{color:colors.goldSoft,fontSize:12,fontWeight:'700'},
 identity:{flexDirection:'row',alignItems:'center',gap:14},
 avatar:{width:66,height:66,borderRadius:33,borderWidth:1,borderColor:colors.gold,
  backgroundColor:colors.surfaceRaised,alignItems:'center',justifyContent:'center'},
 initials:{color:colors.goldSoft,fontSize:22,fontWeight:'800'},
 details:{flex:1,gap:4},name:{color:colors.warmWhite,fontSize:18,fontWeight:'800'},
 secondary:{color:colors.mutedText,fontSize:12,lineHeight:19},
 rule:{height:1,backgroundColor:colors.border},
});
