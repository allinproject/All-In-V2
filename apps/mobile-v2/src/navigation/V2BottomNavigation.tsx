import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, navigation } from '../theme/tokens';
import { v2SelectedTab, v2TabRoutes } from './v2TabRoutes';

/** One canonical, shared navigation surface for the five approved V2 workspaces. */
export function V2BottomNavigation() {
  const pathname = usePathname();
  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {navigation.map((label, index) => {
        const href = v2TabRoutes[index];
        const active = v2SelectedTab(pathname) === label;
        return (
          <Link href={href} asChild key={label}>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              style={StyleSheet.flatten([styles.tab, active && styles.selected])}
            >
              <Text style={[styles.label, active && styles.activeLabel]}>{label}</Text>
            </Pressable>
          </Link>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', backgroundColor: colors.surface, borderTopWidth: 1, borderColor: colors.border, paddingHorizontal: 5, paddingVertical: 7 },
  tab: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  selected: { backgroundColor: colors.surfaceRaised },
  label: { fontSize: 11, fontWeight: '700', color: colors.mutedText },
  activeLabel: { color: colors.goldSoft },
});
