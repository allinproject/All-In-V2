import { useEffect } from 'react';
import { Platform, View } from 'react-native';
import { Stack } from 'expo-router';
import { Sentry } from '../src/monitoring/sentry';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from '../src/auth/AuthProvider';
import { AccessGateProvider } from '../src/auth/AccessGateProvider';
import { V2CoachAccessHost } from '../src/navigation/V2CoachAccessHost';

function RootLayout() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // An interrupted export can leave sensitive JSON in the temporary cache.
    // Clear that exact V2-owned file when the app starts, never user files.
    void import('expo-file-system').then(({ File, Paths }) => {
      const file = new File(Paths.cache, 'allin365-account-export.json');
      if (file.exists) file.delete();
    }).catch(() => {
      // The export screen retries cleanup when the user next opens it.
    });
  }, []);
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <AccessGateProvider>
          <StatusBar style="light" />
          <View style={{ flex: 1, backgroundColor: '#0B0B0B' }}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#090909' } }} />
            <V2CoachAccessHost />
          </View>
        </AccessGateProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
export default Sentry.wrap(RootLayout);
