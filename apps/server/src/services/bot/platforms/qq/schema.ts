import { MAX_BOT_DEBOUNCE_MS } from '@lobechat/const';

import {
  allowFromField,
  displayToolCallsField,
  makeDmPolicyField,
  makeGroupPolicyFields,
  makeUserIdField,
  processingMessageField,
  watchKeywordsField,
} from '../const';
import { deviceAllowFromField } from '../deviceAccess';
import { replyStyleFields } from '../replyStyle';
import type { FieldSchema } from '../types';
import { QQ_DM_POLICIES, QQ_GROUP_POLICIES, qqDevicePolicyField } from './accessSettings';
import { DEFAULT_QQ_CONNECTION_MODE } from './const';

export const schema: FieldSchema[] = [
  {
    key: 'applicationId',
    description: 'channel.applicationIdHint',
    label: 'channel.applicationId',
    required: true,
    type: 'string',
  },
  {
    key: 'credentials',
    label: 'channel.credentials',
    properties: [
      {
        key: 'appSecret',
        description: 'channel.appSecretHint',
        label: 'channel.appSecret',
        required: true,
        type: 'password',
      },
    ],
    type: 'object',
  },
  {
    key: 'settings',
    label: 'channel.settings',
    properties: [
      { ...makeUserIdField('qq'), managed: true },
      qqDevicePolicyField,
      { ...deviceAllowFromField, managed: true },
      {
        key: 'connectionMode',
        default: DEFAULT_QQ_CONNECTION_MODE,
        description: 'channel.connectionModeHint',
        enum: ['websocket', 'webhook'],
        enumDescriptions: [
          'channel.connectionModeWebSocketHint',
          'channel.connectionModeWebhookHint',
        ],
        enumLabels: ['channel.connectionModeWebSocket', 'channel.connectionModeWebhook'],
        label: 'channel.connectionMode',
        type: 'string',
      },
      {
        key: 'charLimit',
        default: 2000,
        description: 'channel.charLimitHint',
        label: 'channel.charLimit',
        maximum: 2000,
        minimum: 100,
        type: 'number',
      },
      {
        key: 'concurrency',
        default: 'queue',
        description: 'channel.concurrencyHint',
        enum: ['queue', 'burst', 'debounce'],
        enumDescriptions: [
          'channel.concurrencyQueueHint',
          'channel.concurrencyBurstHint',
          'channel.concurrencyDebounceHint',
        ],
        enumLabels: [
          'channel.concurrencyQueue',
          'channel.concurrencyBurst',
          'channel.concurrencyDebounce',
        ],
        label: 'channel.concurrency',
        type: 'string',
      },
      {
        key: 'debounceMs',
        default: 5000,
        description: 'channel.debounceMsHint',
        label: 'channel.debounceMs',
        maximum: MAX_BOT_DEBOUNCE_MS,
        minimum: 100,
        type: 'number',
        visibleWhen: { field: 'concurrency', value: ['burst', 'debounce'] },
      },
      {
        key: 'showUsageStats',
        default: false,
        description: 'channel.showUsageStatsHint',
        label: 'channel.showUsageStats',
        type: 'boolean',
      },
      displayToolCallsField,
      processingMessageField,
      makeDmPolicyField({ policy: 'open' }, { policies: QQ_DM_POLICIES }),
      ...makeGroupPolicyFields(
        { policy: 'open' },
        { allowFromVisibleWhen: 'pairing', policies: QQ_GROUP_POLICIES },
      ).map((field) => (field.key === 'groupAllowFrom' ? { ...field, managed: true } : field)),
      { ...allowFromField, managed: true },
      watchKeywordsField,
      ...replyStyleFields,
    ],
    type: 'object',
  },
];
