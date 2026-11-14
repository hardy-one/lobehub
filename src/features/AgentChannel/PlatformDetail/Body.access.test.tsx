/**
 * @vitest-environment happy-dom
 */
import { useForm } from '@lobehub/ui/form';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { schema as discordSchema } from '@/server/services/bot/platforms/discord/schema';
import { schema as qqSchema } from '@/server/services/bot/platforms/qq/schema';
import { schema as telegramSchema } from '@/server/services/bot/platforms/telegram/schema';
import type { SerializedPlatformDefinition } from '@/server/services/bot/platforms/types';

import agentZh from '../../../../locales/zh-CN/agent.json';
import agentEn from '../../../../packages/locales/src/default/agent';
import Body, { type ModuleControls } from './Body';
import { getChannelFormValues, mergeSettingsWithDefaults } from './formState';
import type { ChannelFormValues } from './index';

const state = vi.hoisted(() => ({
  copy: {} as Record<string, string>,
  featureFlags: {} as Record<string, unknown>,
}));

// Resolve real copy instead of echoing keys, so the test sees what a user would read.
vi.mock('react-i18next', () => ({
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  useTranslation: () => ({ t: (key: string) => state.copy[key] ?? key }),
}));

vi.mock('@/store/serverConfig', () => ({
  useServerConfigStore: (selector: (s: { featureFlags: Record<string, unknown> }) => unknown) =>
    selector({ featureFlags: state.featureFlags }),
}));

vi.mock('@/components/FormInput', () => ({
  FormInput: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  FormTextArea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
    <textarea {...props} />
  ),
  FormPassword: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
}));

vi.mock('@/components/InfoTooltip', () => ({
  default: ({ title }: { title?: string }) => <span aria-hidden="true" title={title} />,
}));

vi.mock('@/features/AgentChannel/const', () => ({ getPlatformIcon: () => null }));

vi.mock('@/services/agentBotProvider', () => ({
  agentBotProviderService: { wechatGetQrCode: vi.fn(), wechatPollQrStatus: vi.fn() },
}));

vi.mock('@/hooks/useAppOrigin', () => ({ useAppOrigin: () => 'https://example.test' }));

vi.mock('@/store/agent', () => ({
  useAgentStore: (selector: (state: never) => unknown) =>
    selector({
      activeAgentId: 'agent-1',
      botProvidersMap: {},
      createOwnerBindingCode: vi.fn(),
      internal_refreshBotProviders: vi.fn().mockResolvedValue(undefined),
    } as never),
}));

const discordPlatformDef = {
  documentation: {},
  id: 'discord',
  name: 'Discord',
  schema: discordSchema,
} as unknown as SerializedPlatformDefinition;
const qqPlatformDef = {
  ...discordPlatformDef,
  id: 'qq',
  name: 'QQ',
  schema: qqSchema,
} as unknown as SerializedPlatformDefinition;
const telegramPlatformDef = {
  ...discordPlatformDef,
  id: 'telegram',
  name: 'Telegram',
  schema: telegramSchema,
} as unknown as SerializedPlatformDefinition;

const ACCESS_IDS = ['access-identity', 'access-conversation', 'access-device'] as const;

/** Mounts one platform's access tab with the same persisted form values as the channel page. */
const Harness = ({
  credentials = {},
  definition = discordPlatformDef,
  moduleControls,
  settings,
}: {
  credentials?: Record<string, string>;
  definition?: SerializedPlatformDefinition;
  moduleControls?: ModuleControls;
  settings?: Record<string, unknown>;
}) => {
  const form = useForm<ChannelFormValues>();
  const saved = mergeSettingsWithDefaults(definition.schema, settings ?? {});

  useEffect(() => {
    form.setValues(
      getChannelFormValues({ applicationId: '1', credentials, settings: saved }) as never,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Body
      hasConfig
      activeTab="access"
      currentConfig={{ applicationId: '1', credentials, settings: saved }}
      form={form}
      moduleControls={moduleControls}
      platformDef={definition}
    />
  );
};
const en = agentEn as Record<string, string>;
const zh = agentZh as Record<string, string>;

const controls = (overrides: Partial<ModuleControls> = {}): ModuleControls => ({
  dirty: [],
  ids: ACCESS_IDS,
  onDiscard: vi.fn(),
  onSave: vi.fn(),
  ...overrides,
});

describe('channel settings form: access tab', () => {
  it('splits access into owner identity, conversation and device blocks, each with a Save', () => {
    state.copy = zh;

    render(<Harness moduleControls={controls()} />);

    const titles = [
      zh['channel.access.section.identity'],
      zh['channel.access.section.conversation'],
      zh['channel.access.section.device'],
    ];
    for (const title of titles) expect(screen.getByText(title)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: zh['channel.module.save'] })).toHaveLength(3);
  });

  it('keeps devices to the owner by default and hides the authorized list', () => {
    state.copy = en;

    render(<Harness />);

    const device = screen.getByRole('radiogroup', { name: en['channel.access.device.label'] });
    expect(within(device).getByRole('radio', { name: /Only me/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByText(en['channel.access.device.list'])).not.toBeVisible();
  });

  it('shows the authorized list once devices are shared, and saves only the device block', () => {
    state.copy = en;
    const onSave = vi.fn();

    render(
      <Harness
        moduleControls={controls({ dirty: ['access-device'], onSave })}
        settings={{
          deviceAllowFrom: [{ id: 'friend-1', name: 'Ada' }],
          devicePolicy: 'allowlist',
          userId: 'owner-1',
        }}
      />,
    );

    expect(screen.getByText(en['channel.access.device.list'])).toBeVisible();
    // The list's add button derives its copy from the field label: a missing key shows raw.
    expect(screen.getByRole('button', { name: 'Add person' })).toBeVisible();
    expect(screen.getByDisplayValue('friend-1')).toBeInTheDocument();

    const enabled = screen
      .getAllByRole('button', { name: en['channel.module.save'] })
      .filter((button) => !(button as HTMLButtonElement).disabled);
    expect(enabled).toHaveLength(1);
    fireEvent.click(enabled[0]);
    expect(onSave).toHaveBeenCalledWith('access-device');
  });

  it('warns that nobody can use the devices until the owner ID is filled', () => {
    state.copy = en;

    render(<Harness />);

    expect(screen.getByText(en['channel.access.device.ownerMissing'])).toBeInTheDocument();
  });

  it('renders QQ policies from the declared enums and keeps managed lists read-only', () => {
    state.copy = en;

    render(
      <Harness
        credentials={{ appSecret: 'saved' }}
        definition={qqPlatformDef}
        settings={{
          allowFrom: [{ id: 'approved-user', name: 'Ada' }],
          deviceAllowFrom: [{ id: 'device-user', name: 'Lin' }],
          devicePolicy: 'allowlist',
          dmPolicy: 'allowlist',
          groupAllowFrom: [{ id: 'approved-group', name: 'Support' }],
          groupPolicy: 'pairing',
          userId: 'owner-qq-id',
        }}
      />,
    );

    const dm = screen.getByRole('radiogroup', { name: en['channel.access.dm.label'] });
    expect(within(dm).getAllByRole('radio')).toHaveLength(3);
    expect(within(dm).getByRole('radio', { name: /Approval required/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    const groups = screen.getByRole('radiogroup', { name: en['channel.access.group.label'] });
    expect(within(groups).getAllByRole('radio')).toHaveLength(3);
    expect(
      within(groups).getByRole('radio', { name: /Only group owners and admins/ }),
    ).toBeInTheDocument();
    expect(within(groups).getByText(en['channel.qq.access.group.pairing'])).toBeVisible();
    expect(within(groups).getByText(en['channel.access.group.open'])).toBeVisible();

    expect(within(dm).getByText(en['channel.access.dm.everyone'])).toBeVisible();
    expect(within(dm).getByText(en['channel.access.dm.closed'])).toBeVisible();
    const devices = screen.getByRole('radiogroup', { name: en['channel.access.device.label'] });
    expect(within(devices).getAllByRole('radio')).toHaveLength(3);
    const deviceOptions = within(devices).getAllByRole('radio');
    expect(deviceOptions[0]).toHaveTextContent(en['channel.qq.access.device.owner']);
    expect(deviceOptions[1]).toHaveTextContent(en['channel.qq.access.device.allowlist']);
    expect(deviceOptions[2]).toHaveTextContent(en['channel.qq.access.device.group']);
    expect(within(devices).getByRole('radio', { name: /Only the bound QQ owner/ })).toBeVisible();
    expect(within(devices).getByRole('radio', { name: /Owner and approved people/ })).toBeVisible();
    expect(screen.getByText('approved-user')).toBeVisible();
    expect(screen.getByText('approved-group')).toBeVisible();
    expect(screen.getByText('device-user')).toBeVisible();
    expect(screen.getAllByText(en['channel.qq.managedListHint'])).toHaveLength(3);
    expect(screen.getByText(en['channel.qq.ownerBinding.boundId'])).toBeVisible();
    expect(
      screen.getByRole('button', { name: en['channel.qq.ownerBinding.rebind'] }),
    ).toBeVisible();
    expect(
      screen.queryByRole('button', { name: /Add user|Add channel|Add person/ }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('disables owner-code generation and explains missing QQ credentials', () => {
    state.copy = en;

    render(<Harness definition={qqPlatformDef} />);

    expect(screen.getByText(en['channel.qq.ownerBinding.credentialsRequired'])).toBeVisible();
    expect(
      screen.getByRole('button', { name: en['channel.qq.ownerBinding.generate'] }),
    ).toBeDisabled();
  });

  it('shows legacy QQ disabled groups without selecting a replacement policy', () => {
    state.copy = en;

    render(
      <Harness
        credentials={{ appSecret: 'saved' }}
        definition={qqPlatformDef}
        settings={{ groupPolicy: 'disabled', userId: 'owner-qq-id' }}
      />,
    );

    const groups = screen.getByRole('radiogroup', { name: en['channel.access.group.label'] });
    expect(within(groups).getAllByRole('radio')).toHaveLength(3);
    expect(within(groups).queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    expect(screen.getByText(en['channel.qq.access.group.legacyDisabled'])).toBeVisible();
  });

  it('keeps Telegram’s existing four direct-message choices and copy', () => {
    state.copy = en;

    render(<Harness definition={telegramPlatformDef} />);

    const dm = screen.getByRole('radiogroup', { name: en['channel.access.dm.label'] });
    expect(within(dm).getAllByRole('radio')).toHaveLength(4);
    const options = within(dm).getAllByRole('radio');
    expect(options[0]).toHaveTextContent(en['channel.access.dm.everyone']);
    expect(options[1]).toHaveTextContent(en['channel.access.dm.approval']);
    expect(options[2]).toHaveTextContent(en['channel.access.dm.listed']);
    expect(options[3]).toHaveTextContent(en['channel.access.dm.closed']);
    for (const key of [
      'channel.access.dm.everyone',
      'channel.access.dm.approval',
      'channel.access.dm.listed',
      'channel.access.dm.closed',
    ]) {
      expect(within(dm).getByText(en[key])).toBeVisible();
    }
  });
});
