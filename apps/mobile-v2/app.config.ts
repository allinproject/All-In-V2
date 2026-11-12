import type { ExpoConfig } from 'expo/config';

// Store identities must be the verified App Store Connect / Play Console IDs.
// Never invent them or quietly reuse a V1 signing identity.
const isStoreApplicationId = (value: string | undefined): value is string =>
  typeof value === 'string' &&
  /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(value) &&
  value.length <= 180;
const easProjectId = process.env.ALLIN_V2_EAS_PROJECT_ID?.trim();
const isEasProjectId = (value: string | undefined): value is string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const iosStoreBundleId = process.env.ALLIN_V2_IOS_BUNDLE_ID?.trim();
const androidStorePackage = process.env.ALLIN_V2_ANDROID_PACKAGE?.trim();
const sentryOrganization = process.env.SENTRY_ORG?.trim();
const sentryProject = process.env.SENTRY_PROJECT?.trim();
const plugins: NonNullable<ExpoConfig['plugins']> = ['expo-router', 'expo-sqlite', 'expo-iap'];

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
  ...(isEasProjectId(easProjectId) ? { extra: { eas: { projectId: easProjectId } } } : {}),
  experiments: { typedRoutes: true },
  ios: {
    supportsTablet: true,
    ...(isStoreApplicationId(iosStoreBundleId) ?
      { bundleIdentifier: iosStoreBundleId } : {}),
  },
  android: {
    adaptiveIcon: { backgroundColor: '#090909' },
    ...(isStoreApplicationId(androidStorePackage) ?
      { package: androidStorePackage } : {}),
  }
};

export default config;