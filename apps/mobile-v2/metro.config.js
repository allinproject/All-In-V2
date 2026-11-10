const { getSentryExpoConfig } = require('@sentry/react-native/metro');

// Preserve Expo defaults while enabling symbolication for reviewed releases.
// Source-map uploads require SENTRY_AUTH_TOKEN only in trusted build secrets.
module.exports = getSentryExpoConfig(__dirname);
