# T1 复核：实测用量基线重放到当前 next

## 复核范围与结论摘要

本报告对应当前任务要求：在独立 worktree 的当前 `origin/next` 基线上重放已关闭 PR #7 的实现，并复核“真实 Token 消耗”一致性与回退测试。基线已重新建立为 `d985c9b286b52ce0b508a1367ad407edd3787a00`；原提交 `22a828df50faaeaee12151da3cc0eb8dbedca65c` 已重放为 `00a02ef29e0`。随后重放三项既有修正/测试提交：`45980c49cb9`（排除估算 usage）、`44333826ba8`（空 assistantGroup 壳回退测试）、`8390d867d98`（首轮无 baseline 独立测试）。

结论：原始实现把 `output.usage.totalTokens` 一律当成 provider 实测；当 `usageEstimated=true` 时这不成立，必须排除此类值，不更新可信 baseline。生产阈值判定入口是 `GeneralChatAgent.ts` 的 `checkContextBudget → shouldCompress`。所要求的首轮无锚点、压缩后/锚点丢失、跨模型及 assistantGroup 子消息锚点均有针对性测试；报告同时列出尚未覆盖的 provider 集成和兼容性分支。

## 1. 生产压缩阈值判定入口

唯一生产阈值判定入口为 `packages/agent-runtime/src/agents/GeneralChatAgent.ts:551` 的 `checkContextBudget` 调用 `shouldCompress`（:561）。普通 `call_llm` 与 `init/user_input` 两条生产流程复用入口结果（约 :593–599、:660–666）；`compression_result` 仅处理附件预览 ID，不重新判定 `needsCompression`。`shouldCompress` 的生产调用为该入口；`needsCompression` 的生产消费在同一 agent 的两个流程中。

其它搜索命中不是第二条判定路径：

- `apps/server` 与 `src/services` 的命中为附件预览字段、类型、注释或上下文配置传递，不直接调用压缩阈值判定。
- `packages/context-engine/src/tokenAccounting/index.ts` 的命中是通用 accounting 文档/示例；`attachmentBudget.ts` 负责在调用方传入阈值下规划附件预览，不决定对话是否压缩。
- `src/store/chat` 的 compression 命中负责压缩消息生命周期或手动 compact 操作，不按 token 阈值作生产决策。
- `runtimeFactory` 与 `streamingExecutor` 传递 `compressionConfig.maxWindowToken`，不另行判定。

关键源码摘录（当前重放分支行号）：

```text
GeneralChatAgent.ts:551  private checkContextBudget(...)
GeneralChatAgent.ts:561  return shouldCompress(messages, ...)
GeneralChatAgent.ts:599  消费 needsCompression
GeneralChatAgent.ts:660–666 第二生产流程复用判定结果
```

## 2. API/provider 实测 usage 一致性与 estimated 用量

`callLlmFinalizer.ts` 将 `output.usage?.totalTokens` 写入 `{ model, msgId, tokens }` 作为压缩基线；`GeneralChatAgent.ts:526–536` 校验 baseline 的锚点、token 数及模型，`:551–565` 将其交给 `shouldCompress`。`tokenCounter.ts` 以可信基线加锚点后消息的估算增量计算；没有可用 baseline、锚点无效或模型不同则走整组估算回退。

`usageEstimated=true` 的 usage 是主机估算而不是 provider 返回的实测值：relay 在缺少 provider usage chunk 时调用 `estimateUsage` 并置位该标志；该估算按消息和输出文本调用 tokenizer 估算；服务端 transport 将标志传递给 runtime output；类型元数据也说明这是 server estimated token counts。因此，基线实现无条件存储 `totalTokens` 会把本地估算冒充真实 API 用量，违反 Goal 的核心语义，必须排除。

修正已通过重放提交 `45980c49cb9` 落地：`callLlmFinalizer.ts:289` 使用 `output.usageEstimated ? undefined : output.usage?.totalTokens`。估算值不覆盖旧的可信 baseline；若没有旧 baseline，后续仍使用原有估算路径。`callLlmFinalizer.test.ts:716–735` 覆盖可信 usage 写入，`:737–760` 覆盖 estimated usage 保留旧 baseline，`:762–779` 覆盖无 usage 保持旧 baseline。

限制：此修正排除了显式标记为 host-estimated 的情况；本任务没有证明所有 provider adapter 的 `ModelUsage.totalTokens` 都具有完全一致的计费定义。

## 3. 锚点回退、模型与 assistantGroup 测试覆盖

已覆盖的分支：

- 首轮无 baseline：`GeneralChatAgent.compressionBaseline.test.ts:113–121`，专门构造仅有 user 消息且没有 baseline，断言继续 `call_llm`。它与锚点已消失的测试独立。
- 压缩后摘要/消息被删、baseline 锚点消失：agent 层 `GeneralChatAgent.compressionBaseline.test.ts:100–110` 覆盖走估算/继续请求；`tokenCounter.test.ts:226–238` 覆盖整组估算回退。
- 跨模型 baseline：`GeneralChatAgent.compressionBaseline.test.ts:84–98` 覆盖忽略异模型 baseline；生产校验在 `GeneralChatAgent.ts:530–534`。
- assistantGroup 子消息锚点：`tokenCounter.test.ts:240–267` 覆盖只估算子消息锚点之后的内容。
- 锚点后 group 壳被清空：`tokenCounter.test.ts:269–292` 覆盖丢弃空壳并继续计入后续消息。
- estimated 与真实 usage 分流：`callLlmFinalizer.test.ts:716–779` 覆盖真实 usage、estimated usage 与缺少 usage 三种情况。

未覆盖或仍有边界：没有逐 provider 集成测试证明每个 adapter 的 `totalTokens` 等于该 provider 对输入/输出的计费口径；malformed baseline metadata 与 `currentModel` 为空时的兼容分支未单独测试；顶层 assistantGroup wrapper anchor 没有独立命名测试；所有客户端 provider 组合与中断/失败路径未在本任务完整覆盖。

## 4. 改动面、依赖与 UI

相对当前 `origin/next` 的六个实现/测试文件统计：

```text
35  0  packages/agent-runtime/src/agents/GeneralChatAgent.ts
122 0  packages/agent-runtime/src/agents/__tests__/GeneralChatAgent.compressionBaseline.test.ts
69  0  packages/agent-runtime/src/executors/callLlmFinalizer.test.ts
16  2  packages/agent-runtime/src/executors/callLlmFinalizer.ts
131 0  packages/agent-runtime/src/utils/tokenCounter.test.ts
73  1  packages/agent-runtime/src/utils/tokenCounter.ts
```

合计 446 行新增、3 行删除。没有新增依赖，没有修改 package manifest 或 lockfile；未触及 i18n 或 UI。服务端、context-engine 命中项仅作只读核查，没有改动。

相对旧审查基线 `3620c662ab4413fdbc4fd0bb6e185b5d7fa8d891` 的旧行数统计不可用于当前基线，本节以上述当前 `origin/next` 对比为准。

## 当前工作树、提交与验收证据

任务 worktree：`/home/hardy/Workspace/LobeHub/lobehub-t128`；分支：`fix/compression-threshold-measured-usage`。目标基线为当前 `origin/next`，SHA `d985c9b286b52ce0b508a1367ad407edd3787a00`。四个重放提交依次为：

```text
00a02ef29e0 🐛 fix(agent-runtime): base the compression check on the provider-measured usage
45980c49cb9 🐛 fix(agent-runtime): exclude estimated usage from compression baseline
44333826ba8 ✅ test(agent-runtime): cover empty group baseline fallback
8390d867d98 ✅ test(agent-runtime): cover first-turn baseline fallback
```

必须追加修正/覆盖提交：是。当前分支包含 estimated usage 修正、空 assistantGroup 容器测试和首轮无 baseline 独立测试。

本轮最初只读观察时，主工作树实际位于 `next`，HEAD 为 `d985c9b286b52ce0b508a1367ad407edd3787a00` 且工作区干净。任务要求保护主工作树，故没有切换其分支或修改文件。前轮材料曾记录为 `fix/verify-plan-model-from-service-settings`，该旧记录与本轮观察到的现状不一致；本报告不把旧状态当成本轮事实。

本轮重建后，已执行 `git merge-base --is-ancestor origin/next HEAD` 并得到退出码 0；目标测试与 agent-runtime 全量测试在当前基线上重跑通过（原始输出见本轮验收证据）。报告提交后再次核对 worktree 与主工作树均干净。
