import { formatContextSelections } from '@lobechat/prompts';

import type { MessagesEngineParams } from '../../engine/messages/types';
import { resolveContextSelections } from '../../providers/ContextSelectionsInjector';
import {
  extractSkillImportRoutes,
  formatSkillImportRoutes,
  SKILL_STORE_TOOL_ID,
} from '../../providers/SkillImportRouteInjector';
import { createOnDemandDynamicCandidate, type OnDemandDynamicCandidate } from './dynamicCandidates';

const isSkillStoreReachable = (params: MessagesEngineParams): boolean =>
  (params.toolsConfig?.manifests ?? []).some(
    (manifest) => manifest.identifier === SKILL_STORE_TOOL_ID,
  ) ||
  (params.toolDiscoveryConfig?.availableTools ?? []).some(
    (tool) => tool.identifier === SKILL_STORE_TOOL_ID,
  );

/**
 * Message-owned context cannot be reconstructed from top-level engine params.
 * Keep it in the dynamic suffix so the user's row remains byte-identical while
 * preserving selections and turn-local skill-import routing.
 */
export const collectOnDemandMessageContextCandidates = (input: {
  currentUserMessage: string;
  message: MessagesEngineParams['messages'][number];
  params: MessagesEngineParams;
}): OnDemandDynamicCandidate[] => {
  const { currentUserMessage, message, params } = input;
  const candidates: OnDemandDynamicCandidate[] = [];
  const selections = resolveContextSelections(message.metadata);

  if (selections?.length) {
    const content = formatContextSelections(selections);
    if (content) {
      candidates.push(
        createOnDemandDynamicCandidate({
          content,
          firstTurnEligible: true,
          key: `message:${message.id}:context-selections`,
          kind: 'environment',
          priority: 995,
          relevance: 1,
          required: true,
          source: { id: message.id, type: 'user' },
        }),
      );
    }
  }

  if (isSkillStoreReachable(params)) {
    const routes = extractSkillImportRoutes(currentUserMessage);
    const content = formatSkillImportRoutes(routes);
    if (content) {
      candidates.push(
        createOnDemandDynamicCandidate({
          content,
          firstTurnEligible: true,
          key: `message:${message.id}:skill-import-route`,
          kind: 'environment',
          priority: 965,
          relevance: 1,
          required: true,
          source: { id: message.id, type: 'user' },
        }),
      );
    }
  }

  return candidates;
};
