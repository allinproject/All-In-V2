import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme/tokens';

/** Compact root-workspace header. Today retains its branded home header. */
export function V2WorkspaceHeader({ title }: { title: string }) {
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <Link href="/profile" asChild>
        <Pressable accessibilityRole="button" accessibilityLabel="Profile and settings" style={styles.profile}>
          <Text style={styles.profileText}>Profile</Text>
        </Pressable>
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 12 },
  title: { fontSize: 24, fontWeight: '800', color: colors.warmWhite },
  profile: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
  profileText: { color: colors.goldSoft, fontWeight: '800', fontSize: 13 },
});
