import { describe, expect, it } from 'vitest';

import { SidebarTabKey } from '@/store/global/initialState';

import { MOBILE_NAV_INACTIVE_KEY, resolveMobileNavActiveKey } from './resolveMobileNavActiveKey';

describe('resolveMobileNavActiveKey', () => {
  it('maps the mobile home route to the Assistant tab', () => {
    expect(resolveMobileNavActiveKey('/')).toBe(SidebarTabKey.Chat);
    expect(resolveMobileNavActiveKey('///')).toBe(SidebarTabKey.Chat);
  });

  it('maps the personal center routes to the Me tab', () => {
    expect(resolveMobileNavActiveKey('/me')).toBe(SidebarTabKey.Me);
    expect(resolveMobileNavActiveKey('/me/settings')).toBe(SidebarTabKey.Me);
  });

  it('keeps unrelated routes from selecting the first tab implicitly', () => {
    expect(resolveMobileNavActiveKey('/community')).toBe(MOBILE_NAV_INACTIVE_KEY);
  });
});
