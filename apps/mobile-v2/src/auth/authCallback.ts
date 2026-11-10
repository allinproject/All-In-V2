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
