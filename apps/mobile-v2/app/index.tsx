import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { authRouteState } from '../src/auth/authRoute';
import { colors } from '../src/theme/tokens';

export default function IndexRoute() {
  const { loading, user } = useAuth();
  const gate = useAccessGate();
  const route = authRouteState({ loading, userId: user?.id });

  if (route.state === 'loading' || (route.state === 'signed_in' && gate.status === 'loading')) {
    return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color={colors.gold} />
    </View>;
  }

  if (route.state === 'signed_out') return <Redirect href="/welcome" />;
  if (gate.status === 'legal_required') return <Redirect href="/legal-acceptance" />;
  if (gate.status === 'ready') return <Redirect href="/home" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;

  return <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
    <Text accessibilityRole="header" style={{ color: colors.warmWhite, fontSize: 18, fontWeight: '700', textAlign: 'center' }}>Account setup could not be verified</Text>
    <Text style={{ color: colors.mutedText, textAlign: 'center', lineHeight: 22 }}>{gate.message ?? 'Your account remains protected until setup can be verified.'}</Text>
    <Pressable accessibilityRole="button" onPress={gate.retry} style={{ backgroundColor: colors.gold, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22 }}>
      <Text style={{ color: colors.background, fontWeight: '800' }}>Retry verification</Text>
    </Pressable>
  </View>;
}