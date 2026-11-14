import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../auth/AuthProvider';
import { profileAvatarInitials } from '../features/profile/profileIdentityPresentation';
import { colors } from '../theme/tokens';

/**
 * Canonical avatar entry point. Private profile-photo delivery is not yet
 * connected in V2: never render an unverified or public metadata image URL.
 * Use account initials until the owner-scoped avatar reader is available.
 */
export function V2ProfileAvatarButton() {
  const { user } = useAuth();
  const metadata = user?.user_metadata;
  const name = typeof metadata?.display_name === 'string' ? metadata.display_name
    : typeof metadata?.full_name === 'string' ? metadata.full_name
    : typeof metadata?.name === 'string' ? metadata.name
    : null;
  const initials = name ? profileAvatarInitials(name) : null;
  return (
    <Link href="/profile" asChild>
      <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" style={styles.hitArea}>
        <View style={styles.circle}>
          <Text style={styles.initials}>{initials || '👤'}</Text>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  hitArea: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  circle: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.gold,
    backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  initials: { color: colors.goldSoft, fontWeight: '800', fontSize: 15 },
});
