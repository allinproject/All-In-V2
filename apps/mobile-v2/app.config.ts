import type { ExpoConfig } from 'expo/config';

const config: ExpoConfig = {
  name: 'ALL IN 365 V2',
  slug: 'all-in-365-v2',
  scheme: 'allin365v2',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  plugins: ['expo-router', 'expo-sqlite'],
  experiments: { typedRoutes: true },
  ios: { supportsTablet: true },
  android: { adaptiveIcon: { backgroundColor: '#090909' } }
};

export default config;