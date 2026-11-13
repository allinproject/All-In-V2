import { Link, usePathname } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../auth/AuthProvider';
import { useAccessGate } from '../auth/AccessGateProvider';
import { colors } from '../theme/tokens';

/**
 * V1 CoachAccessHost visual parity, V2 single-conversation routing.
 * Only shown behind the authenticated, legally accepted, completed-onboarding
 * gate. It opens the existing /coach route; it never starts a second thread,
 * guesses context, or triggers additional data reads/permissions.
 */
export function V2CoachAccessHost() {
  const { user, loading } = useAuth();
  const gate = useAccessGate();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const coachOpen = pathname === '/coach' || pathname.endsWith('/coach');
  if (loading || !user || gate.status !== 'ready' || coachOpen) return null;
  return (
    <View pointerEvents="box-none" style={[styles.overlay, { right: Math.max(16, insets.right + 16), bottom: Math.max(80, insets.bottom + 74) }]}>
      <Link href="/coach" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Coach"
          accessibilityHint="Opens your existing Coach conversation"
          style={styles.button}
        >
          <Text style={styles.mark}>✦</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', zIndex: 40, elevation: 8 },
  button: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: colors.background, borderWidth: 1.5, borderColor: colors.gold,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 }, elevation: 8,
  },
  mark: { color: colors.gold, fontSize: 27, fontWeight: '900' },
});
