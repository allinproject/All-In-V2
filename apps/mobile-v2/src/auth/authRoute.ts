export type AuthRouteState =
  | { state: 'loading' }
  | { state: 'signed_out' }
  | { state: 'signed_in'; userId: string };

export function authRouteState(input: {
  loading: boolean;
  userId?: string | null;
}): AuthRouteState {
  if (input.loading) return { state: 'loading' };
  const userId = String(input.userId ?? '').trim();
  return userId ? { state: 'signed_in', userId } : { state: 'signed_out' };
}