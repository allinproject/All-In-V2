import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';

export type GoogleSignInOutcome = 'redirected' | 'cancelled';

/**
 * Supabase owns Google credentials, identity and the PKCE verifier.
 * Expo Router owns /auth/callback and exchanges the returned code exactly once.
 * The browser result must NEVER also call exchangeCodeForSession.
 */
export async function startGoogleSignIn(): Promise<GoogleSignInOutcome> {
  const redirectTo = Linking.createURL('/auth/callback');
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo, skipBrowserRedirect: true },
  });
  if (error) throw error;
  if (!data?.url) throw new Error('Google sign-in is unavailable right now. Try again later.');

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type === 'cancel' || result.type === 'dismiss') return 'cancelled';
  // The native deep link is routed to app/auth/callback.tsx by Expo Router.
  // Do not exchange the same one-use PKCE code here.
  return 'redirected';
}
