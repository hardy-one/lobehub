/**
 * T-198 探针5 · 批 E（消息内包裹族）共用 M2 包裹快照基建。
 *
 * 复用探针1 建立的 `InjectionSnapshotStore`（会话级注入专用存储，与 UI 展示
 * 消息存储物理隔离），不新增存储实现，也不改动其它 Task 正在使用的 key。
 *
 * 四个目标点（G1/G3/G4/G8）都是 T-193 §1.2 的 W 形态：消息内固定偏移包裹，
 * 不新增消息、不改角色与消息数量。持久化走 §1.3 的 M2（确定性投影）：
 * 注入文本由源消息不可变字段（id / metadata / 模板 / 附件元数据）纯函数算出，
 * 首次命中写入本 key，后续 operation 读同一 key 复用同一字节；指纹只取源
 * 不可变字段，绝不使用 Date.now()/随机数。
 */

export const MESSAGE_WRAPPER_SUFFIX = 'messageWrapper';

/**
 * All W-form wrapper points. The first four are T-198; the remaining six are
 * T-200 (批E剩余: G2/G5/G6/G7/G12/G13). Extending this union is backward
 * compatible — the earlier four points keep their exact key/id derivation.
 */
export type MessageWrapperPoint =
  | 'agentSender'
  | 'inputTemplate'
  | 'placeholderVariables'
  | 'messageContent'
  | 'subAgentResult'
  | 'verifyMessage'
  | 'taskCallback'
  | 'reactionFeedback'
  | 'compressedGroup'
  | 'groupRoleTransform'
  // T-203 批C剩余 · D2 (AgentDocumentChangesInjector). Extending this union is
  // backward compatible: every earlier point keeps its exact key/id derivation.
  | 'agentDocChanges';

/**
 * key 布局：`<topicId>:messageWrapper:<point>:<messageId>`。
 * T-198: 'agentSender' | 'inputTemplate' | 'placeholderVariables' | 'messageContent'。
 * T-200: 'subAgentResult' | 'verifyMessage' | 'taskCallback' | 'reactionFeedback' | 'compressedGroup' | 'groupRoleTransform'。
 * T-203: 'agentDocChanges' (D2, Every-User 尾包裹)。
 */
export const messageWrapperKey = (
  topicId: string,
  point: MessageWrapperPoint,
  messageId: string,
): string => `${topicId}:${MESSAGE_WRAPPER_SUFFIX}:${point}:${messageId}`;

/** 注入块通用快照：payload 为需 prepend/append 的已固化文本。 */
export interface WrapperSnapshot {
  /** 源不可变字段派生指纹，无墙钟、无随机。 */
  fingerprint: string;
  /** 固化后的注入文本；解释方式由各点自行决定。 */
  payload: string;
  /** G8：追加文本段后是否对整段文本 trim（保留原模板行为）。 */
  trimAfter?: boolean;
}

/** G4 专用：固化后的占位符取值表，避免每次 operation 重算运行时变量。 */
export interface PlaceholderValuesSnapshot {
  fingerprint: string;
  values: Record<string, string>;
}

/** W 形态注入块的确定性 id，写入 metadata 供 P2 断言（MessageCleanup 后仍可核）。 */
export const wrapperBlockId = (point: string, messageId: string, fingerprint: string): string =>
  `inject:${point}:${messageId}:${fingerprint}`;
