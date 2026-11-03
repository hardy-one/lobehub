import { type OptimisticUpdateContext } from '@/store/chat/slices/message/actions/optimisticUpdate';
import { type ChatStore } from '@/store/chat/store';

/**
 * In-memory draft store for an intervention form. Backs the renderer's
 * "remember what I'd partially answered" behaviour without paying for a
 * DB round-trip on every keystroke — drafts only matter while the
 * intervention is pending (10 min cap), and the canonical pluginState
 * mirror is enough to survive HMR / panel re-mounts.
 *
 * `askUserDraft` is irrelevant after submit (the form unmounts), so we
 * don't bother clearing it — it stays buried under `askUserAnswers` in
 * `pluginState` and never affects the completed Render.
 */
export const setInterventionDraft = (
  get: () => ChatStore,
  toolMessageId: string,
  draft: Record<string, unknown>,
): void => {
  get().internal_dispatchMessage({
    id: toolMessageId,
    key: 'askUserDraft',
    type: 'updatePluginState',
    value: draft,
  });
};

/**
 * Persist the structured intervention answers (`{ questionText:
 * selectedLabel | selectedLabel[] }`) to the tool message's
 * `pluginState.askUserAnswers`. Drives structured Q&A rendering on the
 * `Render` component without re-parsing the bridge's prose tool_result.
 *
 * Both writes are merge-style by key — the in-memory `updatePluginState`
 * reducer (`message/reducer.ts:142`) and the DB
 * `messageModel.updatePluginState` shallow-merge so co-existing keys
 * (`askUserDraft` etc.) survive. DB write is best-effort: a slow lambda
 * must not strand the IPC submit that follows.
 */
export const setInterventionAnswers = async (
  get: () => ChatStore,
  toolMessageId: string,
  answers: Record<string, unknown>,
  context?: OptimisticUpdateContext,
): Promise<void> => {
  get().internal_dispatchMessage(
    {
      id: toolMessageId,
      key: 'askUserAnswers',
      type: 'updatePluginState',
      value: answers,
    },
    context,
  );
  try {
    const { messageService } = await import('@/services/message');
    const ctx = get().internal_getConversationContext(context);
    await messageService.updateMessagePluginState(toolMessageId, { askUserAnswers: answers }, ctx);
  } catch (err) {
    console.warn('[setInterventionAnswers] persist failed:', err);
  }
};
