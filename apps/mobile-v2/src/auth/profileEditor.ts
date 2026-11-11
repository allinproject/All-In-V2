export function normalizeV2DisplayName(input: string): string | null {
  const normalized = input.trim().replace(/\s+/g, ' ');
  if (normalized.length > 80) throw new Error('Display name must be 80 characters or fewer.');
  if (/[\u0000-\u001F\u007F]/.test(normalized)) throw new Error('Display name cannot contain control characters.');
  return normalized || null;
}

export function profileOwnerMatches(profile: unknown, expectedUserId: string): boolean {
  return Boolean(profile && typeof profile === 'object' && !Array.isArray(profile)
    && (profile as { user_id?: unknown }).user_id === expectedUserId);
}
