/**
 * Regression for the mobile home search list's "Add New Category" entry.
 *
 * The search rows reuse the desktop row menu, whose entry used to resolve
 * through `useOptionalAgentModal()`. The mobile layout mounts no
 * `AgentModalProvider`, so on mobile that entry closed the menu and opened
 * nothing. The row now binds the mobile category modal helper that the default
 * mobile list already uses, and this suite keeps the binding behaviour-checked
 * with no provider mounted, exactly like the mobile layout.
 */
import { ModalHost, MotionProvider } from '@lobehub/ui';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AgentSearchList } from './AgentSearchList';

interface RowMenuParams {
  id: string;
  openCreateGroupModal: () => void;
}

const mocks = vi.hoisted(() => ({
  addGroup: vi.fn(async (name: string) => `sg_${name}`),
  menuParams: undefined as unknown as RowMenuParams,
  toast: { error: vi.fn(), info: vi.fn(), loading: vi.fn(), success: vi.fn(), warning: vi.fn() },
  toggleExpandSessionGroup: vi.fn(),
  updateAgentGroup: vi.fn(async () => {}),
}));

interface HomeStateStub {
  addGroup: typeof mocks.addGroup;
  updateAgentGroup: typeof mocks.updateAgentGroup;
}

interface GlobalStateStub {
  toggleExpandSessionGroup: typeof mocks.toggleExpandSessionGroup;
}

/**
 * The row menu is the seam the entry is handed to; capturing its params lets the
 * test drive the entry without driving a base-ui submenu in jsdom.
 */
vi.mock('@/features/HomeSidebar/Body/Agent/List/AgentItem/useDropdownMenu', () => ({
  useAgentDropdownMenu: (params: RowMenuParams) => {
    mocks.menuParams = params;
    return () => [];
  },
}));

vi.mock('@/features/HomeSidebar/Body/Agent/List/Item/Actions', () => ({ default: () => null }));

/** Mirror the mobile surface: `isMobile` is on and no `AgentModalProvider` is mounted. */
vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (state: { isMobile: boolean }) => unknown) =>
    selector({ isMobile: true }),
}));

vi.mock('@lobehub/ui', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  toast: mocks.toast,
}));

vi.mock('@/hooks/usePermission', () => ({
  usePermission: () => ({ allowed: true, reason: '' }),
}));

vi.mock('@/store/global', () => ({
  useGlobalStore: (selector: (state: GlobalStateStub) => unknown) =>
    selector({ toggleExpandSessionGroup: mocks.toggleExpandSessionGroup }),
}));

vi.mock('@/store/home', () => ({
  useHomeStore: Object.assign(
    (selector: (state: HomeStateStub) => unknown) =>
      selector({ addGroup: mocks.addGroup, updateAgentGroup: mocks.updateAgentGroup }),
    { getState: () => ({ refreshAgentList: vi.fn(async () => {}) }) },
  ),
}));

// Real WAAPI animations under happy-dom reject `finished` when the modal tree is
// torn down on cleanup; swallow that rejection the same way the imperative modal
// suite does so this file does not flake on unhandled rejections.
const originalAnimate = Element.prototype.animate;
beforeAll(() => {
  Element.prototype.animate = function (this: Element, ...args) {
    const animation = originalAnimate.apply(this, args);
    animation.finished.catch(() => {});
    return animation;
  } as typeof originalAnimate;
});
afterAll(() => {
  Element.prototype.animate = originalAnimate;
});

const agentItem = {
  avatar: null,
  backgroundColor: null,
  id: 'agt_mobile_1',
  pinned: false,
  title: 'Mobile Alpha Agent',
  type: 'agent',
  visibility: 'private',
};

const Wrapper = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <MotionProvider motion={motion}>
      {children}
      {/* The app mounts the host once in `SPAGlobalProvider`; imperative modals need it. */}
      <ModalHost />
    </MotionProvider>
  </MemoryRouter>
);

const openCategoryModalFromRow = async () => {
  render(
    <Wrapper>
      <AgentSearchList dataSource={[{ ...agentItem } as any]} />
    </Wrapper>,
  );

  // No `AgentModalProvider` is mounted above: a null context would leave the
  // entry as the silent no-op this suite exists to catch.
  await act(async () => {
    mocks.menuParams.openCreateGroupModal();
  });

  return screen.findByRole('dialog', {}, { timeout: 3000 });
};

describe('AgentSearchList category entry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.addGroup.mockResolvedValue('sg_new_category');
  });

  it('opens the category modal instead of doing nothing', async () => {
    const dialog = await openCategoryModalFromRow();

    expect(within(dialog).getByRole('textbox')).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'OK' })).toBeInTheDocument();
  });

  it('creates the category and moves the row agent into it', async () => {
    const user = userEvent.setup();
    const dialog = await openCategoryModalFromRow();

    await user.type(within(dialog).getByRole('textbox'), 'Mobile Alpha Group');
    await user.click(within(dialog).getByRole('button', { name: 'OK' }));

    await waitFor(() =>
      expect(mocks.addGroup).toHaveBeenCalledWith('Mobile Alpha Group', 'private'),
    );
    await waitFor(() =>
      expect(mocks.updateAgentGroup).toHaveBeenCalledWith('agt_mobile_1', 'sg_new_category'),
    );
    await waitFor(() =>
      expect(mocks.toggleExpandSessionGroup).toHaveBeenCalledWith('sg_new_category', true),
    );
    expect(mocks.toast.success).toHaveBeenCalled();
  });
});
