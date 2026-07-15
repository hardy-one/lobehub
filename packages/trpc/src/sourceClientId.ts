import { uuid } from '@lobechat/utils';

export const SOURCE_CLIENT_ID_HEADER = 'X-Lobe-Source-Client-Id';
export const SOURCE_CLIENT_ID_STORAGE_KEY = 'lobehub:source-client-id';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

let processSourceClientId: string | undefined;

const getProcessSourceClientId = () => {
  processSourceClientId ??= uuid();

  return processSourceClientId;
};

export const parseSourceClientId = (value?: string | null) => {
  const sourceClientId = value?.trim();

  return sourceClientId && UUID_PATTERN.test(sourceClientId) ? sourceClientId : undefined;
};

export const getSourceClientId = () => {
  try {
    const storedSourceClientId = parseSourceClientId(
      globalThis.localStorage?.getItem(SOURCE_CLIENT_ID_STORAGE_KEY),
    );
    if (storedSourceClientId) return storedSourceClientId;

    const sourceClientId = getProcessSourceClientId();
    globalThis.localStorage?.setItem(SOURCE_CLIENT_ID_STORAGE_KEY, sourceClientId);

    return sourceClientId;
  } catch {
    // Restricted/private browser storage can throw. Keep the source stable for
    // this page lifetime without logging the private identifier.
    return getProcessSourceClientId();
  }
};
