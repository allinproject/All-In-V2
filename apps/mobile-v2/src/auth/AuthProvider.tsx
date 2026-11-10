import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

export type AuthContextValue = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  authNotice: string | null;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const currentUserId = useRef<string | null>(null);
  const authoritativeEvent = useRef(false);
  const alive = useRef(false);
  const identityGeneration = useRef(0);
  const hadAuthenticatedSession = useRef(false);
  const manualSignOut = useRef(false);
  const signOutInFlight = useRef<Promise<void> | null>(null);

  useEffect(() => {
    alive.current = true;
    let mounted = true;

    const { data: authSubscription } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (!mounted) return;
      const nextUserId = nextSession?.user?.id ?? null;
      if (event !== 'INITIAL_SESSION') authoritativeEvent.current = true;
      if (nextUserId !== currentUserId.current || event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
        identityGeneration.current += 1;
      }

      if (nextSession) {
        if (event === 'SIGNED_IN') manualSignOut.current = false;
        hadAuthenticatedSession.current = true;
        setAuthNotice(null);
      } else if (event === 'SIGNED_OUT') {
        const wasAuthenticated = hadAuthenticatedSession.current;
        hadAuthenticatedSession.current = false;
        if (manualSignOut.current) manualSignOut.current = false;
        else if (wasAuthenticated) setAuthNotice('Your session expired. Sign in again to continue.');
      }

      currentUserId.current = nextUserId;
      setSession(nextSession);
      setLoading(false);
    });

    const restoreGeneration = identityGeneration.current;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted || authoritativeEvent.current || identityGeneration.current !== restoreGeneration) return;
      if (error) {
        setAuthNotice('Your session could not be restored. Check your connection and sign in again.');
      }
      const restored = error ? null : (data.session ?? null);
      currentUserId.current = restored?.user?.id ?? null;
      hadAuthenticatedSession.current = Boolean(restored);
      setSession(restored);
      setLoading(false);
    }).catch(() => {
      if (!mounted || authoritativeEvent.current || identityGeneration.current !== restoreGeneration) return;
      currentUserId.current = null;
      hadAuthenticatedSession.current = false;
      setSession(null);
      setAuthNotice('Your session could not be restored. Check your connection and sign in again.');
      setLoading(false);
    });

    return () => {
      mounted = false;
      alive.current = false;
      authSubscription.subscription.unsubscribe();
    };
  }, []);

  const signOut = useCallback((): Promise<void> => {
    if (signOutInFlight.current) return signOutInFlight.current;
    const startUserId = currentUserId.current;
    const startGeneration = identityGeneration.current;
    manualSignOut.current = true;

    const operation = (async () => {
      try {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      } catch (error) {
        manualSignOut.current = false;
        throw error;
      }

      manualSignOut.current = false;
      if (alive.current && startUserId && identityGeneration.current === startGeneration) {
        authoritativeEvent.current = true;
        currentUserId.current = null;
        hadAuthenticatedSession.current = false;
        identityGeneration.current += 1;
        setSession(null);
        setLoading(false);
      }
    })().finally(() => {
      signOutInFlight.current = null;
    });

    signOutInFlight.current = operation;
    return operation;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    session,
    user: session?.user ?? null,
    loading,
    authNotice,
    signOut,
  }), [session, loading, authNotice, signOut]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}