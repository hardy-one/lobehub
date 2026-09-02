import { HETEROGENEOUS_TYPE_LABELS } from '@lobechat/heterogeneous-agents';

export const getHeterogeneousTypeLabel = (type?: string | null): string | undefined =>
  type ? (HETEROGENEOUS_TYPE_LABELS[type] ?? type) : undefined;
