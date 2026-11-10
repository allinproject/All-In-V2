import type { ExpoConfig } from 'expo/config';

const sentryOrganization = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();
const plugins: NonNullable<ExpoConfig['plugins']> = ['expo-router', 'expo-sqlite'];

// Do not turn on native Sentry build hooks with guessed project identifiers.
// Configure both values in the trusted build environment before native acceptance.
if (sentryOrganization && sentryProject) {
  plugins.push(['@sentry/react-native/expo', {
    url: 'https://sentry.io/',
    organization: sentryOrganization,
    project: sentryProject,
  }]);
}

const config: ExpoConfig = {
  name: 'ALL IN 365 V2',
  slug: 'all-in-365-v2',
  scheme: 'allin365v2',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'dark',
  plugins,
  experiments: { typedRoutes: true },
  ios: { supportsTablet: true },
  android: { adaptiveIcon: { backgroundColor: '#090909' } }
};

export default config;