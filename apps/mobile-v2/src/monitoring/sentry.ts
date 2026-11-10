import * as Sentry from '@sentry/react-native';
import { scrubCrashEvent, sentryDsnIsConfigured } from './sentryPrivacy';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN?.trim();

// Crash/error reporting only. No user identity, session replay, performance
// tracing, profiling, screen recording or automatic sensitive breadcrumbs.
if (sentryDsnIsConfigured(dsn)) {
  Sentry.init({
    dsn,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    enableAutoSessionTracking: false,
    attachStacktrace: true,
    beforeSend(event) {
      return scrubCrashEvent(event);
    },
  });
}

export { Sentry };
