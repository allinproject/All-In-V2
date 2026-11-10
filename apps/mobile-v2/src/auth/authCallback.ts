export type AuthCallbackParams = {
  code?: string | string[];
  type?: string | string[];
  error?: string | string[];
  error_description?: string | string[];
};

export type AuthCallbackResolution =
  | { kind: 'error'; message: string }
  | { kind: 'exchange'; code: string; destination: 'app' | 'reset-password' };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? '').trim();
}

/**
 * Stable identity of a received deep link. The callback screen uses this to
 * consume each link once while still accepting a newer link on the same route.
 */
export function authCallbackRequestKey(params: AuthCallbackParams): string {
  return JSON.stringify([
    first(params.code),
    first(params.type),
    first(params.error),
    first(params.error_description),
  ]);
}

export function resolveAuthCallback(params: AuthCallbackParams): AuthCallbackResolution {
  if (first(params.error) || first(params.error_description)) {
    return {
      kind: 'error',
      message: 'The email link could not be verified. Request a new link and try again.',
    };
  }

  const code = first(params.code);
  if (!code) {
    return {
      kind: 'error',
      message: 'This email link is missing its verification code. Request a new link and open it on this device.',
    };
  }

  return {
    kind: 'exchange',
    code,
    destination: first(params.type) === 'recovery' ? 'reset-password' : 'app',
  };
}
