import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { v2EmailAuthRedirectUrl } from './emailAuthRedirect';

/**
 * Supabase email callbacks must be registered in Auth > URL Configuration.
 * Expo Go's session-scoped exp:// callback is opt-in only after the *exact*
 * current URL is approved there. This is not an unrestricted wildcard.
 */
export function getV2EmailAuthRedirectUrl(recovery = false): string {
  return v2EmailAuthRedirectUrl({
    expoGo: Constants.appOwnership === 'expo',
    expoGoEnabled: process.env.EXPO_PUBLIC_V2_EXPO_GO_AUTH_REDIRECT_ENABLED === 'true',
    expoGoLinkingUri: Constants.linkingUri,
    nativeCallbackUrl: Linking.createURL('/auth/callback'),
    recovery,
  });
}
