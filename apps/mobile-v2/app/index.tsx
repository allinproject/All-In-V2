import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useAuth } from '../src/auth/AuthProvider';
import { useAccessGate } from '../src/auth/AccessGateProvider';
import { authRouteState } from '../src/auth/authRoute';

export default function IndexRoute() {
  const { loading, user } = useAuth();
  const gate = useAccessGate();
  const route = authRouteState({ loading, userId: user?.id });

  if (route.state === 'loading' || (route.state === 'signed_in' && gate.status === 'loading')) {
    return <View style={{ flex: 1, backgroundColor: '#0B0B0B', alignItems: 'center', justifyContent: 'center' }}>
      <ActivityIndicator color="#B79A57" />
    </View>;
  }

  if (route.state === 'signed_out') return <Redirect href="/sign-in" />;
  if (gate.status === 'ready') return <Redirect href="/home" />;
  if (gate.status === 'onboarding_required') return <Redirect href="/onboarding-required" />;

  return <View style={{ flex: 1, backgroundColor: '#0B0B0B', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 }}>
    <Text accessibilityRole="header" style={{ color: '#F7F4EC', fontSize: 18, fontWeight: '700', textAlign: 'center' }}>Account setup could not be verified</Text>
    <Text style={{ color: '#AAA69D', textAlign: 'center', lineHeight: 22 }}>{gate.message ?? 'Your account remains protected until setup can be verified.'}</Text>
    <Pressable accessibilityRole="button" onPress={gate.retry} style={{ backgroundColor: '#B79A57', borderRadius: 12, paddingVertical: 13, paddingHorizontal: 22 }}>
      <Text style={{ color: '#0B0B0B', fontWeight: '800' }}>Retry verification</Text>
    </Pressable>
  </View>;
}