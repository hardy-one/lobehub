import type { FieldSchema } from '@/server/services/bot/platforms/types';

export interface StanceSettings {
  allowFrom?: unknown;
  dmPolicy?: string;
}

/** How many usable rows (with an ID) a list holds. */
export const countListed = (list: unknown): number =>
  Array.isArray(list)
    ? list.filter(
        (entry) =>
          entry &&
          typeof entry === 'object' &&
          String((entry as { id?: unknown }).id ?? '').trim() !== '',
      ).length
    : 0;

/** Resolve a stored policy against its platform declaration, preserving unknown legacy values. */
export const getDeclaredPolicy = (
  field: FieldSchema | undefined,
  raw: unknown,
): string | undefined => {
  const options = field?.enum ?? [];
  if (typeof raw !== 'string' || !raw) {
    return typeof field?.default === 'string' ? field.default : options[0];
  }
  if (options.includes(raw)) return raw;
  if (raw === 'allowlist' && options.includes('pairing')) return 'pairing';
  return raw;
};

/** A populated global list still implies allowlist on platforms that declare that policy. */
export const deriveDmPolicy = (
  settings: StanceSettings,
  field?: FieldSchema,
): string | undefined => {
  const policy = getDeclaredPolicy(field, settings.dmPolicy);
  if (
    policy === 'open' &&
    (!field?.enum || field.enum.includes('allowlist')) &&
    countListed(settings.allowFrom) > 0
  ) {
    return 'allowlist';
  }
  return policy;
};

export interface PolicyChange {
  /** People removed from the list by applying this policy. */
  dropped: number;
  patch: Record<string, unknown>;
}

/** Apply a declared DM policy, clearing the global list only where it restricts the open policy. */
export const applyDmPolicy = (
  policy: string,
  settings: StanceSettings,
  field?: FieldSchema,
): PolicyChange => {
  const clearsGlobalList = policy === 'open' && (!field?.enum || field.enum.includes('allowlist'));
  if (!clearsGlobalList) return { dropped: 0, patch: { dmPolicy: policy } };

  return {
    dropped: countListed(settings.allowFrom),
    patch: { allowFrom: [], dmPolicy: policy },
  };
};

export type AccessIssue = 'approverMissing' | 'groupListEmpty' | 'listEmpty';

export interface AccessSettings extends StanceSettings {
  deviceAllowFrom?: unknown;
  devicePolicy?: string;
  groupAllowFrom?: unknown;
  groupPolicy?: string;
  userId?: unknown;
}

/** Things that leave the current choice not working the way it reads. */
export const accessIssues = (
  settings: AccessSettings,
  dmPolicyField?: FieldSchema,
): AccessIssue[] => {
  const issues: AccessIssue[] = [];
  const userId = typeof settings.userId === 'string' ? settings.userId.trim() : '';
  const dmPolicy = deriveDmPolicy(settings, dmPolicyField);

  if (dmPolicy === 'pairing' && !userId) issues.push('approverMissing');
  if (dmPolicy === 'allowlist' && countListed(settings.allowFrom) === 0) issues.push('listEmpty');
  if (settings.groupPolicy === 'allowlist' && countListed(settings.groupAllowFrom) === 0)
    issues.push('groupListEmpty');

  return issues;
};

const hasId = (entry: unknown) =>
  typeof entry === 'string'
    ? entry.trim() !== ''
    : !!entry &&
      typeof entry === 'object' &&
      String((entry as { id?: unknown }).id ?? '').trim() !== '';

const isFieldVisible = (
  field: FieldSchema | undefined,
  settings: AccessSettings,
  fields: FieldSchema[],
) => {
  if (!field?.visibleWhen) return true;
  const conditions = Array.isArray(field.visibleWhen) ? field.visibleWhen : [field.visibleWhen];
  return conditions.every(({ field: key, value: expected }) => {
    const policyField = fields.find((item) => item.key === key);
    const actual = policyField
      ? getDeclaredPolicy(policyField, settings[key as keyof AccessSettings])
      : settings[key as keyof AccessSettings];
    return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
  });
};

/**
 * Remove unfinished rows only when their schema-declared list is hidden. Hidden
 * lists with usable rows stay intact so switching policies never drops data.
 */
export const dropHiddenIncompleteRows = (
  settings: AccessSettings,
  fields: FieldSchema[] = [],
): Record<string, unknown> => {
  const patch: Record<string, unknown> = {};
  const byKey = new Map(fields.map((field) => [field.key, field]));
  const canInspect = (key: string) => fields.length === 0 || byKey.has(key);
  const prune = (key: 'allowFrom' | 'deviceAllowFrom' | 'groupAllowFrom') => {
    const list = settings[key];
    if (Array.isArray(list) && list.some((entry) => !hasId(entry))) patch[key] = list.filter(hasId);
  };

  if (canInspect('allowFrom')) {
    const dmField = byKey.get('dmPolicy');
    const dmPolicy = getDeclaredPolicy(dmField, settings.dmPolicy);
    const peopleListShown =
      dmPolicy === 'pairing' ||
      (dmField?.enum?.includes('allowlist') && dmPolicy === 'allowlist') ||
      countListed(settings.allowFrom) > 0;
    if (!peopleListShown) prune('allowFrom');
  }

  if (canInspect('groupAllowFrom')) {
    const groupField = byKey.get('groupAllowFrom');
    const visible = groupField
      ? isFieldVisible(groupField, settings, fields)
      : settings.groupPolicy === 'allowlist' || settings.groupPolicy === 'pairing';
    if (!visible) prune('groupAllowFrom');
  }

  if (canInspect('deviceAllowFrom')) {
    const listField = byKey.get('deviceAllowFrom');
    const visible = listField
      ? isFieldVisible(listField, settings, fields)
      : settings.devicePolicy === 'allowlist';
    if (!visible) prune('deviceAllowFrom');
  }

  return patch;
};
