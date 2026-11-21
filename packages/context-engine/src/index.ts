// Core types and interfaces
export * from './types';

// Base classes
export { BaseFirstUserContentProvider } from './base/BaseFirstUserContentProvider';
export { BaseLastUserContentProvider } from './base/BaseLastUserContentProvider';
export { BaseProcessor } from './base/BaseProcessor';
export { BaseProvider } from './base/BaseProvider';
export { BaseSystemRoleProvider } from './base/BaseSystemRoleProvider';
export { BaseVirtualLastUserContentProvider } from './base/BaseVirtualLastUserContentProvider';

// Context Engine
export * from './engine';
export type { ContextEngineConfig } from './pipeline';
export { ContextEngine } from './pipeline';

// Context Providers
export * from './providers';

// Session-scoped injection snapshot store (T-193 §1.3 M1 / T-194 共用基建)
export {
  type ContextSelectionsSnapshot,
  EVERY_USER_CONTEXT_SELECTIONS_SUFFIX,
  everyUserContextSelectionsKey,
  type FingerprintSnapshot,
  FIRST_USER_EXPERTISE_SUFFIX,
  firstUserExpertiseKey,
  InjectionSnapshotStore,
  LAST_USER_ACTIVE_DOC_SUFFIX,
  LAST_USER_DOCUMENT_REFERENCE_SUFFIX,
  LAST_USER_PROJECT_SUFFIX,
  LAST_USER_SELECTED_SKILLS_SUFFIX,
  LAST_USER_SELECTED_TOOLS_SUFFIX,
  LAST_USER_SKILL_IMPORT_ROUTE_SUFFIX,
  LAST_USER_TASK_MGR_SUFFIX,
  LAST_USER_TOPIC_REFERENCE_SUFFIX,
  lastUserActiveDocKey,
  lastUserDocumentReferenceKey,
  lastUserProjectKey,
  lastUserSelectedSkillsKey,
  lastUserSelectedToolsKey,
  lastUserSkillImportRouteKey,
  lastUserTaskMgrKey,
  lastUserTopicReferenceKey,
  STABLE_PREFIX_ADDITIONAL_CONTEXT_SUFFIX,
  stablePrefixAdditionalContextKey,
  TAIL_ADDITIONAL_CONTEXT_SUFFIX,
  TAIL_GOAL_CONTEXT_SUFFIX,
  TAIL_ONBOARDING_STATE_SUFFIX,
  tailAdditionalContextKey,
  tailGoalContextKey,
  tailOnboardingStateKey,
  VIRTUAL_TAIL_ONBOARDING_HINT_SUFFIX,
  VIRTUAL_TAIL_TODOS_SUFFIX,
  virtualTailOnboardingHintKey,
  virtualTailTodosKey,
} from './injection/InjectionSnapshotStore';

// T-198 批 E 消息内包裹族共用 M2 快照基建
export {
  MESSAGE_WRAPPER_SUFFIX,
  messageWrapperKey,
  type PlaceholderValuesSnapshot,
  wrapperBlockId,
  type WrapperSnapshot,
} from './injection/MessageWrapperSnapshots';

// Token accounting (compression triggers + UI breakdown)
export type {
  ContextTokenAccounting,
  CountContextTokensParams,
  InputTokenBuckets,
  MessageTokenBreakdown,
  TokenSourceType,
  ToolDefinitionTokenBreakdown,
} from './tokenAccounting';
export type { EstimateRequestInputTokensOptions } from './tokenAccounting';
export {
  addTokenBuckets,
  countContextTokens,
  DEFAULT_DRIFT_MULTIPLIER,
  EMPTY_TOKEN_BUCKETS,
  estimatePendingUploadTokenBuckets,
  estimateRequestInputTokens,
  estimateSentMessageAttachmentTokenBuckets,
  isTextLikeUploadFile,
} from './tokenAccounting';
export type {
  AttachmentPreviewPlan,
  PlanAttachmentPreviewsParams,
} from './tokenAccounting/attachmentBudget';
export { planAttachmentPreviews } from './tokenAccounting/attachmentBudget';
export type {
  CountRequestPayloadTokensParams,
  RequestPayloadMessage,
} from './tokenAccounting/requestPayload';
export {
  countRequestPayloadTokens,
  tryCountRequestPayloadTokens,
} from './tokenAccounting/requestPayload';
// Processors
export type {
  DocumentRead,
  PlaceholderValue,
  PlaceholderValueMap,
  RevokedDocumentReads,
} from './processors';
export {
  buildPlaceholderGenerators,
  cacheEconomicsForProvider,
  collectDocumentReads,
  formatPlaceholderValues,
  getSlicedMessages,
  GroupMessageFlattenProcessor,
  HistoryTruncateProcessor,
  HYDRATED_TOOL_RESULTS,
  InputTemplateProcessor,
  MessageCleanupProcessor,
  MessageContentProcessor,
  PlaceholderVariablesProcessor,
  renderPlaceholderTemplate,
  ToolCallProcessor,
  ToolMessageReorder,
} from './processors';
