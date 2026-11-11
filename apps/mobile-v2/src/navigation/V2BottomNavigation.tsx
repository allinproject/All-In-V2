import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, navigation } from '../theme/tokens';

const destinations = ['/home', '/fuel', '/train', '/community', '/coach'] as const;

/** One canonical, shared navigation surface for the five approved V2 workspaces. */
export function V2BottomNavigation() {
  const pathname = usePathname();
  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {navigation.map((label, index) => {
        const href = destinations[index];
        const active = pathname === href || pathname.startsWith(href + '/');
        return (
          <Link href={href} asChild key={label}>
            <Pressable
              accessibilityRole="tab"
              accessibilityLabel={label}
              accessibilityState={{ selected: active }}
              style={[styles.tab, active && styles.selected]}
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
