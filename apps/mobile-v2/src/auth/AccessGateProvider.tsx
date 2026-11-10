import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import { resolveV2Access } from './accessGateClient';
import { supabase } from '../lib/supabase';

export type V2AccessStatus = 'loading' | 'ready' | 'onboarding_required' | 'error';
type OwnedStatus = { ownerId: string | null; status: V2AccessStatus; message: string | null };
type V2AccessContextValue = {
  status: V2AccessStatus;
  message: string | null;
  retry: () => void;
};

const AccessGateContext = createContext<V2AccessContextValue | null>(null);

export function AccessGateProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading } = useAuth();
  const ownerId = user?.id ?? null;
  const pendingLegal = user?.user_metadata?.allin_legal_acceptance_pending ?? null;
  const explicitOnboarding = user?.user_metadata?.allin_training_onboarding_complete ?? null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<OwnedStatus>({
    ownerId: null, status: 'loading', message: null,
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setResult({ ownerId: null, status: 'loading', message: null });
      return;
    }

    let current = true;
    setResult({ ownerId: user.id, status: 'loading', message: null });
    void resolveV2Access(supabase, user).then(access => {
      if (!current) return;
      setResult({
        ownerId: user.id,
        status: access.needsOnboarding ? 'onboarding_required' : 'ready',
        message: null,
      });
    }).catch(() => {
      if (!current) return;
      setResult({
        ownerId: user.id,
        status: 'error',
        message: 'ALL IN 365 could not verify your account setup. Your private app data remains locked until this check succeeds.',
      });
    });

    return () => { current = false; };
  }, [authLoading, user?.id, pendingLegal, explicitOnboarding, attempt]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const status = !ownerId || result.ownerId !== ownerId ? 'loading' : result.status;
  const value = useMemo(() => ({
    status,
    message: status === 'error' ? result.message : null,
    retry,
  }), [status, result.message, retry]);

  return <AccessGateContext.Provider value={value}>{children}</AccessGateContext.Provider>;
}

export function useAccessGate() {
  const value = useContext(AccessGateContext);
  if (!value) throw new Error('useAccessGate must be used inside AccessGateProvider.');
  return value;
}