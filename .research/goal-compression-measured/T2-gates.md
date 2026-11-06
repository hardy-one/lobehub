# T2 仓库门禁与回归测试证据

## 评估范围

仅执行 T-129 当前任务契约：在 `fix/compression-threshold-measured-usage` 上运行 agent-runtime 全量测试、改动文件 `bun run check`、分支与 `origin/next` 的 type-check 对照，以及新增测试修复前失败/修复后通过的复现。没有运行全仓测试 `bun run test`，没有实施整体 Goal 或其他 Task。

- 仓库：`/home/hardy/Workspace/LobeHub/lobehub-t128`
- 分支：`fix/compression-threshold-measured-usage`
- `origin/next`：`d985c9b286b52ce0b508a1367ad407edd3787a00`
- 本轮门禁开始时 HEAD：`c79e092d0a2039b45726e995eb49facc41c66e29`
- 新增估算 usage 修正提交：`45980c49cb9`；此前报告确认其余业务修正已在本分支。最终门禁基线将在此报告提交后重新记录。

## 结果摘要

| 门禁 | 结果 | 归属 / 说明 |
|---|---|---|
| `cd packages/agent-runtime && bunx vitest run` | 33 files passed，613 tests passed | 未发现失败项。本轮没有在基线另跑全量 agent-runtime 测试；失败归属因此不适用。stderr 中有一条测试主动模拟数据库故障的预期日志，不影响通过结果。 |
| 根目录 `bun run check <6 个改动文件>` | 最终通过：6 files lint clean，161 tests passed | 首次运行 lint 阶段因 worktree 缺少 `prettier-plugin-sh`、`prettier-plugin-packagejson`、`prettier-plugin-sort-json` 而报 fatal。确认这些插件已存在于主工作树安装目录后，为目标 worktree 补了仅本地 `node_modules` 软链，再运行同一门禁成功。自动修复只删除 `callLlmFinalizer.test.ts` 末尾空白行；diff 已审阅，语义无变化。 |
| `bun run type-check` 分支 | exit 2，4 条 TypeScript 错误 | 四条均在本任务未改文件：`apps/server/.../userMemory.ts` 两条 TS18047、`src/features/Conversation/.../messageIndex.ts` 一条 TS2339、`src/services/heterogeneousAgent.ts` 一条 TS2345。当前分支没有触及这三处。完整输出见 raw 文件。 |
| `bun run type-check` 干净 `origin/next` worktree | exit 2，520 条错误，包含上述四条 | 对照受本机依赖映射污染：为避免在干净 worktree 重装未缓存依赖，临时复用了目标 worktree 的 `node_modules`；`node_modules/packages` 和 `@achaos/core` 解析指向目标分支源码，导致大量跨工作树解析错误。`pnpm install --offline` 也无法建立独立基线，因锁定依赖 `@lobehub/editor@7.2.1` 不在本地缓存可用版本中。故不能将此 520 条作为有效同口径基线，type-check 的“无新增错误”结论未能成立；仅能确认当前分支自身 4 条均不在本次改动文件，且四条在基线输出中也复现。 |
| 新增回归测试修复前/后 | 修复前 3 files failed、4 failed / 38 passed；修复后 3 files passed、42 passed | 修复前是在 `origin/next` 原始源码上叠加本分支测试文件运行，正确使用 `packages/agent-runtime` Vitest 配置。失败覆盖 production baseline 缺失和对 baseline/fallback 的断言；修复后测试在最终业务源码上通过。两份完整原始输出见 raw 文件。 |

## 执行命令

全量 agent-runtime：

```sh
cd packages/agent-runtime && bunx vitest run
```

改动文件检查：

```sh
bun run check packages/agent-runtime/src/agents/GeneralChatAgent.ts packages/agent-runtime/src/agents/__tests__/GeneralChatAgent.compressionBaseline.test.ts packages/agent-runtime/src/executors/callLlmFinalizer.test.ts packages/agent-runtime/src/executors/callLlmFinalizer.ts packages/agent-runtime/src/utils/tokenCounter.test.ts packages/agent-runtime/src/utils/tokenCounter.ts
```

该命令最后一次输出为：

```text
✓ 6 files · lint clean (1 auto-fixed) · tests 161 passed
auto-fixed (1 files, full diff: /tmp/check-autofix-1793961922924.diff):
packages/agent-runtime/src/executors/callLlmFinalizer.test.ts
--- a/packages/agent-runtime/src/executors/callLlmFinalizer.test.ts
+++ b/packages/agent-runtime/src/executors/callLlmFinalizer.test.ts
@@ -780,5 +780,4 @@
       tokens: 1_000,
     });
   });
-
 });
```

修复前基线测试：

```sh
cd <干净 origin/next worktree>/packages/agent-runtime
bunx vitest run src/agents/__tests__/GeneralChatAgent.compressionBaseline.test.ts src/executors/callLlmFinalizer.test.ts src/utils/tokenCounter.test.ts
```

修复后测试：同一命令在目标分支 `packages/agent-runtime` 下运行。

## 原始日志

以下原始输出与报告一起提交，完整记录命令结果：

- `t2-raw/agent-runtime-vitest.txt`
- `t2-raw/regression-before-origin-next.txt`
- `t2-raw/regression-after-fix.txt`
- `t2-raw/type-check-branch.txt`
- `t2-raw/type-check-origin-next.txt`

回归失败输出的关键片段：

```text
FAIL src/agents/__tests__/GeneralChatAgent.compressionBaseline.test.ts > GeneralChatAgent compression baseline > compresses from the measured baseline of the previous call
AssertionError: expected { payload: { …(2) }, type: 'call_llm' } to deeply equal { payload: { …(3) }, …(1) }
- "type": "compress_context"
+ "type": "call_llm"
Test Files  3 failed (3)
Tests  4 failed | 38 passed (42)
```

修复后输出：

```text
✓ src/executors/callLlmFinalizer.test.ts (19 tests)
✓ src/agents/__tests__/GeneralChatAgent.compressionBaseline.test.ts (4 tests)
✓ src/utils/tokenCounter.test.ts (19 tests)
Test Files  3 passed (3)
Tests  42 passed (42)
```

全量测试输出的最终计数：

```text
Test Files  33 passed (33)
Tests  613 passed (613)
Duration  4.92s
```

## 结论与边界

业务回归证据闭合：原始 `origin/next` 实现无法通过新增行为测试，修复后的三份测试文件共 42 项通过；agent-runtime 全量 613 项通过，`check` 的 lint 与相关测试通过，且自动格式修复已审阅。type-check 本分支仍以 exit 2 结束，错误均在未改文件；干净基线的依赖复用方式引入解析污染，因此无法据该对照作出“相同错误批次”的可靠结论。要完成可信的全仓类型基线，需要提供与 `origin/next` 锁文件一致的独立依赖安装环境，或修复该分支的依赖锁定/缓存前置条件后重新运行两侧同一命令。

本报告未把无法成立的 type-check 基线对照标成通过。未运行 `bun run test`。未 push、未创建 PR，也未将本 Task 扩大为整体 Goal 完成。
