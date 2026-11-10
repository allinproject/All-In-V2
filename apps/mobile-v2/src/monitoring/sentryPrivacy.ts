/**
 * Deliberately small allowlist for V2 crash diagnostics.
 * The app owns athlete data; unexpected telemetry must not include it.
 */
export function scrubCrashEvent<T extends {
  user?: unknown;
  request?: unknown;
  contexts?: unknown;
  extra?: unknown;
  tags?: unknown;
  breadcrumbs?: unknown;
  message?: string;
  exception?: { values?: Array<{ value?: string }> };
}>(event: T): T {
  delete event.user;
  delete event.request;
  delete event.contexts;
  delete event.extra;
  delete event.tags;
  delete event.breadcrumbs;
  delete event.message;
  for (const exception of event.exception?.values ?? []) {
    if (exception.value) exception.value = '[redacted]';
  }
  return event;
}

export function sentryDsnIsConfigured(dsn: string | undefined): boolean {
  return !!dsn && /^https:\/\/[^\s@]+@[^/\s]+\/\d+$/.test(dsn);
}
