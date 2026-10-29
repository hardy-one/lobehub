import { BRANDING_NAME, LOBE_CHAT_CLOUD, ORG_NAME } from '@lobechat/business-const';

import pkg from '../../../package.json';
// type-only: loads ./global.d.ts so `__ELECTRON__` exists even when this
// package is compiled from a workspace without the app's ambient declarations
import type {} from './global';

export const CURRENT_VERSION = pkg.version;

/**
 * The User-Agent every request LobeHub makes outwards carries.
 *
 * A provider or client that must look like something else (Claude Code's
 * quota check posing as `claude-cli`, Codex's as `codex-cli`) sets its own
 * and is the exception; everything else sends this one, so the requests are
 * told apart from an SDK's own.
 */
export const LOBE_USER_AGENT = `lobehub/${CURRENT_VERSION}`;

export const isDesktop = typeof __ELECTRON__ !== 'undefined' && !!__ELECTRON__;

// @ts-ignore
export const isCustomBranding = BRANDING_NAME !== 'LobeHub';
// @ts-ignore
export const isCustomORG = ORG_NAME !== 'LobeHub';

// Re-exported so packages that deliberately do not depend on the business-const
// slot — @lobechat/locales, which only needs the names to rewrite brand strings
// baked into translations — can resolve them through the same adaptation layer
// this package already provides for BRANDING_INBOX_TITLE (see ./meta).
export { BRANDING_NAME, LOBE_CHAT_CLOUD };
