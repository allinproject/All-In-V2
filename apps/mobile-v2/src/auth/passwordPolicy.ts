/** Keep in sync with the V2 Supabase Email provider minimum password length. */
export const MIN_PASSWORD_LENGTH = 12;

export function meetsV2PasswordMinimum(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}

/** Validate the two fields before attempting an authenticated recovery write. */
export function v2PasswordResetValidationError(password: string, confirmation: string): string | null {
  if (!meetsV2PasswordMinimum(password)) {
    return `Use a password with at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password !== confirmation) return 'The passwords do not match.';
  return null;
}
