import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect } from 'expo-router';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { File, Paths } from 'expo-file-system';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '../../src/auth/AuthProvider';
import { v2AuthenticatedScreenKey } from '../../src/auth/authRoute';
import { assertV2SessionOwner } from '../../src/auth/accessGateClient';
import { prepareV2AccountExport } from '../../src/features/profile/accountExport';
import { previewV2AccountExport, removeV2ExportFile } from '../../src/features/profile/accountExportFile';
import { supabase } from '../../src/lib/supabase';
import { colors } from '../../src/theme/tokens';

export default function AccountExportScreen() {
  const { user, sessionGeneration } = useAuth();
  return <OwnedAccountExport key={v2AuthenticatedScreenKey(user?.id ?? null, sessionGeneration)} />;
}

function OwnedAccountExport() {
  const { user, loading: authLoading } = useAuth();
  const owner = user?.id ?? null;
  const mounted = useRef(false);
  const busy = useRef(false);
  const cachedFile = useRef<File | null>(null);
  const [fileReady, setFileReady] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A prior crash may leave a temporary plaintext export in the cache.
  // Delete it on screen mount and again when this account/session screen unmounts.
  // Do not delete immediately after preview(): the native viewer may still read it.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const file = new File(Paths.cache, 'allin365-account-export.json');
    cachedFile.current = file;
    try { removeV2ExportFile(file); } catch { /* File cleanup can be retried manually. */ }
    return () => {
      try { removeV2ExportFile(file); } catch { /* Cache remains OS-managed. */ }
      cachedFile.current = null;
    };
  }, []);

  useFocusEffect(useCallback(() => {
    mounted.current = true;
    setConfirming(false);
    setError(null);
    return () => { mounted.current = false; };
  }, [owner]));

  async function shareSnapshot() {
    if (!owner || !mounted.current || busy.current || sharing || !confirming) return;
    if (Platform.OS === 'web') {
      setError('Account JSON file export is available in the iOS and Android app.');
      return;
    }
    busy.current = true;
    setSharing(true);
    setError(null);
    try {
      await assertV2SessionOwner(supabase, owner);
      const { data, error: rpcError } = await supabase.rpc('v2_export_my_account_snapshot', {
        p_expected_user_id: owner,
      });
      if (rpcError) throw rpcError;
      const json = prepareV2AccountExport(data, owner);
      // Reverify the account after the RPC and before writing any private bytes.
      await assertV2SessionOwner(supabase, owner);
      if (!mounted.current || !cachedFile.current) return;
      const file = cachedFile.current;
      setFileReady(false);
      await previewV2AccountExport(json, file, async () => {
        await assertV2SessionOwner(supabase, owner);
        return mounted.current && cachedFile.current === file;
      });
      if (mounted.current) {
        setFileReady(true);
        setConfirming(false);
      }
    } catch (cause) {
      if (mounted.current) {
        setFileReady(false);
        setError(cause instanceof Error ? cause.message : 'Could not prepare the account export.');
      }
    } finally {
      busy.current = false;
      if (mounted.current) setSharing(false);
    }
  }

  if (!authLoading && !user) return <Redirect href="/sign-in" />;
  if (authLoading || !user) return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Link href="/profile" asChild>
          <Pressable accessibilityRole="button" style={styles.back}>
            <Text style={styles.gold}>‹ Profile</Text>
          </Pressable>
        </Link>
        <Text accessibilityRole="header" style={styles.title}>Export my data</Text>
        <View style={styles.card}>
          <Text style={styles.heading}>Your ALL IN 365 data</Text>
          <Text style={styles.body}>Create a JSON file containing the account information currently available in V2, including profile, settings, onboarding, legal acceptance and health considerations you entered.</Text>
          <Text style={styles.body}>Your device opens the JSON file. You can save or share it using the viewer's available options. It is not yet a complete long-term archive of activities, media, or connected services. Future unsupported data types block export rather than being silently omitted.</Text>
          <Text style={styles.body}>The file may contain sensitive personal data. A temporary, unencrypted copy is created in app cache and removed when you leave this screen or choose Remove temporary file. Only save or share with a location you trust.</Text>
        </View>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        <View style={styles.card}>
          {!confirming ? (
            <Pressable accessibilityRole="button" style={styles.button} onPress={() => setConfirming(true)}>
              <Text style={styles.buttonText}>Review sharing confirmation</Text>
            </Pressable>
          ) : (
            <>
              <Text style={styles.heading}>Create and open private JSON file?</Text>
              <Text style={styles.body}>This will request your latest account data, create a temporary JSON file, and open your device's file preview. Nothing is sent to another app unless you explicitly choose to save or share it.</Text>
              <Pressable accessibilityRole="button" accessibilityState={{disabled:sharing,busy:sharing}}
                disabled={sharing} style={styles.button} onPress={() => void shareSnapshot()}>
                {sharing ? <ActivityIndicator color={colors.gold} /> : <Text style={styles.buttonText}>Create and open JSON file</Text>}
              </Pressable>
              <Pressable accessibilityRole="button" disabled={sharing} style={styles.button}
                onPress={() => setConfirming(false)}>
                <Text style={styles.buttonText}>Keep my data private</Text>
              </Pressable>
            </>
          )}
        </View>
        {fileReady ? (
          <View style={styles.card}>
            <Text style={styles.body}>A temporary account export file is in the app cache. Remove it after saving to a trusted location.</Text>
            <Pressable accessibilityRole="button" disabled={sharing} style={styles.button}
              onPress={() => {
                try {
                  removeV2ExportFile(cachedFile.current);
                  setFileReady(false);
                } catch {
                  setError('Could not remove the temporary export file. Close and reopen the screen to retry.');
                }
              }}>
              <Text style={styles.buttonText}>Remove temporary export file</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: 24, paddingBottom: 48, gap: 16 },
  back: { minHeight: 44, justifyContent: 'center' },
  gold: { color: colors.gold },
  title: { color: colors.warmWhite, fontSize: 28, fontWeight: '800' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 16, backgroundColor: colors.surface, padding: 16, gap: 12 },
  heading: { color: colors.warmWhite, fontSize: 18, fontWeight: '800' },
  body: { color: colors.mutedText, fontSize: 14, lineHeight: 21 },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
  button: { minHeight: 48, padding: 12, borderWidth: 1, borderColor: colors.border, borderRadius: 12, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.surfaceRaised },
  buttonText: { color: colors.warmWhite, fontWeight: '700' },
});
