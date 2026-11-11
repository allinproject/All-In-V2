import { navigation } from '../theme/tokens';

export const v2TabRoutes = ['/home', '/fuel', '/train', '/community', '/coach'] as const;

/** The Today tab uses the existing /home route; no duplicate Today screen. */
export function v2SelectedTab(pathname: string): (typeof navigation)[number] | null {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  const index = v2TabRoutes.findIndex(route => normalized === route || normalized.startsWith(route + '/'));
  return index === -1 ? null : navigation[index];
}
