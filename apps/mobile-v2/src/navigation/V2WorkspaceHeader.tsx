import { StyleSheet, Text, View } from 'react-native';
import { V2ProfileAvatarButton } from './V2ProfileAvatarButton';
import { colors } from '../theme/tokens';

/** Compact root-workspace header. Today retains its branded home header. */
export function V2WorkspaceHeader({ title }: { title: string }) {
  return (
    <View style={styles.row}>
      <Text accessibilityRole="header" style={styles.title}>{title}</Text>
      <V2ProfileAvatarButton />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 44, gap: 12 },
  title: { fontSize: 22, fontWeight: '800', color: colors.warmWhite },
});
