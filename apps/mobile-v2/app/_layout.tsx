import { Stack } from 'expo-router';
import { Sentry } from '../src/monitoring/sentry';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/auth/AuthProvider';
import { AccessGateProvider } from '../src/auth/AccessGateProvider';

function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AccessGateProvider>
          <StatusBar style="light" />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#090909' } }} />
        </AccessGateProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
export default Sentry.wrap(RootLayout);
