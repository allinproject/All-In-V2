/**
 * An Expo Go JavaScript experience cannot register the app's native
 * allin365v2:// scheme. Email confirmation/reset links must instead target
 * the exact exp:// or exps:// development session when explicitly enabled.
 *
 * Never broaden the Supabase redirect allowlist to arbitrary hosts or schemes.
 * The founder must register the exact emitted callback URL for this session.
 * Standalone builds keep the permanent application scheme.
 */
export type V2EmailRedirectInput = {
  expoGo: boolean;
  expoGoEnabled: boolean;
  expoGoLinkingUri: string | null | undefined;
  nativeCallbackUrl: string;
  recovery?: boolean;
};

export function v2EmailAuthRedirectUrl(input: V2EmailRedirectInput): string {
  if (!input.expoGo) {
    if (!/^allin365v2:\/\/auth\/callback(?:\?|$)/.test(input.nativeCallbackUrl)) {
      throw new Error('ALL IN 365 email callback scheme is not configured for the installed app.');
    }
    return input.recovery ? appendRecovery(input.nativeCallbackUrl) : input.nativeCallbackUrl;
  }

  if (!input.expoGoEnabled) {
    throw new Error('Email links in Expo Go need an approved Expo Go callback. Finish the secure redirect setup before requesting another email.');
  }

  const base = String(input.expoGoLinkingUri ?? '').trim().replace(/\/+$/, '');
  // Only the live development server URL may receive an email callback.
  if (!/^exps?:\/\/[^/?#]+(?::\d+)?$/i.test(base)) {
    throw new Error('The Expo Go development address could not be verified. Restart Expo and try again.');
  }
  // This is the same device-local Expo Router path that handles one-time PKCE.
  const callback = `${base}/--/auth/callback`;
  return input.recovery ? appendRecovery(callback) : callback;
}

function appendRecovery(url: string): string {
  return url.includes('?') ? `${url}&type=recovery` : `${url}?type=recovery`;
}
