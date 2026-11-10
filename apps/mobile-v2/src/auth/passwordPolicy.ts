/** Keep in sync with the V2 Supabase Email provider minimum password length. */
export const MIN_PASSWORD_LENGTH = 12;

export function meetsV2PasswordMinimum(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH;
}
