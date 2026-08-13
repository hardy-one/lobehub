/**
 * Agent-mode stamp for recorded context tokens (`agent|chat` + promptMode).
 * Must mirror the stamp written on the send side
 * (`services/chat/index.ts` → buildAssistantMessageContext) and the gateway
 * transport (`store/chat/.../gateway.ts` → context_metrics):
 *   - agent / efficient: `agent:<full|lean>`
 *   - chat:              `chat:<full|lean>`
 *
 * `enableAgentMode` is nullable on the client — treat anything but an
 * explicit `false` as agent mode, matching the send side's
 * `chatConfig.enableAgentMode !== false` derivation.
 */
export const getTokenTagMode = (enableAgentMode?: boolean, promptMode?: string) =>
  `${enableAgentMode === false ? 'chat' : 'agent'}:${promptMode ?? 'full'}`;
