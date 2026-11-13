import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../../theme/tokens';
import { RouteBuilderContent } from './routeBuilder/RouteBuilderContent';

type Workspace = 'routes' | 'routines';

/**
 * Routes mount the ported V1 interactive editor without unapproved legacy writers.
 * Routine storage and its editor remain separately gated by canonical V2 ownership.
 */
export function RoutesRoutinesContent() {
  const [selected, setSelected] = useState<Workspace>('routes');
  return <View style={styles.root}>
    <View accessibilityRole="tablist" style={styles.tabs}>
      {(['routes', 'routines'] as const).map(tab => (
        <Pressable
          key={tab} accessibilityRole="tab" accessibilityLabel={tab === 'routes' ? 'Routes' : 'Routines'}
          accessibilityState={{ selected: selected === tab }}
          onPress={() => setSelected(tab)}
          style={[styles.tab, selected === tab && styles.selected]}
        ><Text style={[styles.tabText, selected === tab && styles.selectedText]}>
          {tab === 'routes' ? 'Routes' : 'Routines'}
        </Text></Pressable>
      ))}
    </View>
    <View style={[styles.body, selected !== 'routes' && styles.hidden]}
      accessibilityElementsHidden={selected !== 'routes'}
      importantForAccessibility={selected === 'routes' ? 'auto' : 'no-hide-descendants'}>
      <Text accessibilityRole="header" style={styles.title}>Routes</Text>
      <RouteBuilderContent />
      <Text style={styles.muted}>Your existing saved routes have not been checked. Canonical route saving and provider-backed rerouting remain gated.</Text>
    </View>
    {selected === 'routines' ? (
      <View style={styles.body}>
        <Text accessibilityRole="header" style={styles.title}>Routines</Text>
        <Text style={styles.subheading}>Reusable workouts</Text>
        <Text style={styles.muted}>The routine library and editor are not connected yet.</Text>
        <Text style={styles.muted}>Your saved routines have not been checked.</Text>
      </View>
    )}
  </View>;
}
const styles = StyleSheet.create({
  root: { gap: 16 },
  hidden: { display: 'none' },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: colors.border },
  selected: { borderBottomWidth: 2, borderBottomColor: colors.gold },
  tabText: { fontSize: 14, fontWeight: '700', color: colors.mutedText },
  selectedText: { color: colors.goldSoft },
  body: { borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 18, gap: 12 },
  title: { fontSize: 23, fontWeight: '900', color: colors.warmWhite },
  subheading: { fontSize: 16, fontWeight: '800', color: colors.goldSoft },
  muted: { fontSize: 13, color: colors.mutedText, lineHeight: 19 },
});
