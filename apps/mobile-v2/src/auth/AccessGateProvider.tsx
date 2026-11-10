import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import { isV2AccessAttemptCurrent } from './authRoute';
import { resolveV2Access, type V2LegalDocument } from './accessGateClient';
import { supabase } from '../lib/supabase';

export type V2AccessStatus = 'loading' | 'ready' | 'legal_required' | 'onboarding_required' | 'error';
type OwnedStatus = {
  ownerId: string | null;
  attempt: number;
  sessionGeneration: number;
  status: V2AccessStatus;
  message: string | null;
  requiredLegalDocuments: V2LegalDocument[];
};
type V2AccessContextValue = {
  status: V2AccessStatus;
  message: string | null;
  requiredLegalDocuments: V2LegalDocument[];
  retry: () => void;
};

const AccessGateContext = createContext<V2AccessContextValue | null>(null);

export function AccessGateProvider({ children }: { children: React.ReactNode }) {
  const { user, loading: authLoading, sessionGeneration } = useAuth();
  const ownerId = user?.id ?? null;
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<OwnedStatus>({
    ownerId: null,
    attempt: 0,
    sessionGeneration: 0,
    status: 'loading',
    message: null,
    requiredLegalDocuments: [],
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setResult({ ownerId: null, attempt, sessionGeneration, status: 'loading', message: null, requiredLegalDocuments: [] });
      return;
    }

    let current = true;
    setResult({ ownerId: user.id, attempt, sessionGeneration, status: 'loading', message: null, requiredLegalDocuments: [] });
    void resolveV2Access(supabase, user).then(access => {
      if (!current) return;
      const status: V2AccessStatus = access.needsLegalAcceptance
        ? 'legal_required'
        : access.needsOnboarding
          ? 'onboarding_required'
          : 'ready';
      setResult({
        ownerId: user.id,
        attempt,
        sessionGeneration,
        status,
        message: null,
        requiredLegalDocuments: access.requiredLegalDocuments,
      });
    }).catch(caught => {
      if (!current) return;
      const message = caught instanceof Error
        ? caught.message
        : 'V2 account setup could not be verified. Private access remains closed.';
      setResult({
        ownerId: user.id,
        attempt,
        sessionGeneration,
        status: 'error',
        message,
        requiredLegalDocuments: [],
      });
    });

    return () => { current = false; };
  }, [authLoading, user?.id, attempt, sessionGeneration]);

  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const status = isV2AccessAttemptCurrent(result.ownerId, result.attempt, ownerId, attempt, authLoading, result.sessionGeneration, sessionGeneration)
    ? result.status
    : 'loading';
  const value = useMemo(() => ({
    status,
    message: status === 'error' ? result.message : null,
    requiredLegalDocuments: status === 'legal_required' ? result.requiredLegalDocuments : [],
    retry,
  }), [status, result.message, result.requiredLegalDocuments, retry]);

  return <AccessGateContext.Provider value={value}>{children}</AccessGateContext.Provider>;
}

export function useAccessGate() {
  const value = useContext(AccessGateContext);
  if (!value) throw new Error('useAccessGate must be used inside AccessGateProvider.');
  return value;
}