/**
 * Resolve the effective agent id for a tool call.
 *
 * Group-agent member tool calls carry the supervisor as `agentId`; the
 * effective agent is the `subAgentId` (unless the operation itself is scoped
 * to `sub_agent`, where the sub-agent must not be re-resolved). Shared by
 * ClientToolTransport and the plugin invocation actions so scope-sensitive
 * executors (e.g. lobe-remote-device) resolve the same id.
 */
export const resolveEffectiveAgentId = ({
  agentId,
  scope,
  subAgentId,
}: {
  agentId?: string;
  scope?: string | null;
  subAgentId?: string | null;
}): string | undefined => (subAgentId && scope !== 'sub_agent' ? subAgentId : agentId);
