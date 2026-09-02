import { SidebarTabKey } from '@/store/global/initialState';

export const MOBILE_NAV_INACTIVE_KEY = '__mobile-nav-inactive__';

export type MobileNavActiveKey =
  SidebarTabKey.Chat | SidebarTabKey.Me | typeof MOBILE_NAV_INACTIVE_KEY;

/**
 * The generic sidebar resolver returns the first URL segment. Mobile's Chat tab
 * owns the personal home route (`/`), not a `/chat` route, so it needs a
 * route-to-tab mapping of its own.
 */
export const resolveMobileNavActiveKey = (pathname: string): MobileNavActiveKey => {
  const normalizedPathname = pathname.length > 1 ? pathname.replace(/\/+$/, '') || '/' : pathname;

  if (normalizedPathname === '/') return SidebarTabKey.Chat;
  if (normalizedPathname === '/me' || normalizedPathname.startsWith('/me/')) {
    return SidebarTabKey.Me;
  }

  // The bar is also shown on routes such as /community, which belong to neither
  // tab. A sentinel keeps TabBar from falling back to its first item.
  return MOBILE_NAV_INACTIVE_KEY;
};
