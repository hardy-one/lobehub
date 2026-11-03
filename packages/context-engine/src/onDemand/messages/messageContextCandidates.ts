import { formatContextSelections } from '@lobechat/prompts';

import type { MessagesEngineParams } from '../../engine/messages/types';
import { resolveContextSelections } from '../../providers/ContextSelectionsInjector';
import {
  extractSkillImportRoutes,
  formatSkillImportRoutes,
  SKILL_STORE_TOOL_ID,
} from '../../providers/SkillImportRouteInjector';
import { createOnDemandDynamicCandidate, type OnDemandDynamicCandidate } from './dynamicCandidates';

const CURRENT_SELECTION_PRIORITY = 995;
const HISTORICAL_SELECTION_PRIORITY = 40;
const HISTORICAL_SELECTION_RELEVANCE = 0.85;
const SKILL_IMPORT_ROUTE_PRIORITY = 965;

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
 * preserving selections and turn-local skill-import routing. Historical
 * selections remain eligible but sort after the current turn's selection.
 */
export const collectOnDemandMessageContextCandidates = (input: {
  currentUserMessage: string;
  currentUserMessageIndex: number;
  messages: MessagesEngineParams['messages'];
  params: MessagesEngineParams;
}): OnDemandDynamicCandidate[] => {
  const { currentUserMessage, currentUserMessageIndex, messages, params } = input;
  const candidates: OnDemandDynamicCandidate[] = [];

  messages.forEach((message, index) => {
    if (message.role !== 'user') return;

    const selections = resolveContextSelections(message.metadata);
    if (!selections?.length) return;

    const content = formatContextSelections(selections);
    if (!content) return;

    const messageId = message.id || `index-${index}`;
    const isCurrentMessage = index === currentUserMessageIndex;
    candidates.push(
      createOnDemandDynamicCandidate({
        content,
        firstTurnEligible: true,
        key: `message:${messageId}:context-selections`,
        kind: 'environment',
        priority: isCurrentMessage ? CURRENT_SELECTION_PRIORITY : HISTORICAL_SELECTION_PRIORITY,
        relevance: isCurrentMessage ? 1 : HISTORICAL_SELECTION_RELEVANCE,
        required: false,
        source: { id: messageId, type: 'user' },
      }),
    );
  });

  const currentMessage = messages[currentUserMessageIndex];
  if (currentMessage && isSkillStoreReachable(params)) {
    const routes = extractSkillImportRoutes(currentUserMessage);
    const content = formatSkillImportRoutes(routes);
    if (content) {
      const messageId = currentMessage.id || `index-${currentUserMessageIndex}`;
      candidates.push(
        createOnDemandDynamicCandidate({
          content,
          firstTurnEligible: true,
          key: `message:${messageId}:skill-import-route`,
          kind: 'environment',
          priority: SKILL_IMPORT_ROUTE_PRIORITY,
          relevance: 1,
          required: true,
          source: { id: messageId, type: 'user' },
        }),
      );
    }
  }

  return candidates;
};
