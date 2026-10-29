import { appEnv } from './app';

/**
 * Base URL the queue (QStash or a self-hosted, API-compatible server) uses to
 * call back into this deployment.
 *
 * Use when:
 * - Building schedule destinations, workflow trigger URLs and delayed publish URLs
 * - The queue cannot reach the public APP_URL (a self-hosted queue on the same
 *   Docker network would hairpin through the public edge)
 *
 * Returns:
 * - `QSTASH_CALLBACK_BASE_URL` when set, otherwise APP_URL; `undefined` when the
 *   deployment exposes no URL at all, which callers treat as a misconfiguration.
 */
export const getQStashCallbackBaseUrl = (): string | undefined =>
  process.env.QSTASH_CALLBACK_BASE_URL ||
  process.env.APP_URL ||
  appEnv?.APP_URL ||
  appEnv?.INTERNAL_APP_URL;
