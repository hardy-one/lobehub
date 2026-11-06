# T-130 产品级验收：实测用量驱动上下文压缩判定

## 目标与验收口径

验证同一 worktree 的真实 LobeHub 对话是否将 Provider 返回的实测 token usage 作为压缩阈值 baseline，并验证首轮/锚点缺失时是否退回全量估计。判定要求来自本 Task 的冻结 Acceptance；代码或单元测试不能代替真实运行记录。本报告仅覆盖 T-130，不代表整体 Goal 或其他 Task 已完成。

开始前检查 `.agents/skills/acceptance/SKILL.md`：这是影响产品压缩行为的变更，按其“Product behavior lacks valid evidence”分支必须执行产品验收。按照 `.agents/acceptance/PROJECT.md` 的 no-`.env` 流程启动服务，并依 `.agents/acceptance/PROCESS.md` 记录运行、范围、证据和清理边界。

## 结论

**产品级两种情形均未能完成；真实对话在模型请求前因无可用 Provider API key 失败。** 本地基础栈已启动且通过 agent-runtime preflight，CLI 对话确实进入本地 Agent Runtime/QStash 队列，但 operation 最终为 `error`，错误为 `InvalidProviderAPIKey`。因此没有 Provider 响应，也没有 operation `{msgId,tokens,model}`、baseline 判定、threshold/needsCompression 实值或账单 usage 可供比对。没有使用模拟 usage，也没有将代码推断包装为产品实测。

“本地运行证据已采集、发布链接缺失”：当前只采集到本地栈和失败运行证据，没有可发布的成功验收 round；没有为成功验收生成链接。本轮 LobeHub CLI 的常规认证配置指向自托管 `https://lobe.hardynio.xyz`，离线 doctor 显示凭据来自本地 stored login，但这不提供运行此本地账号所缺少的 Provider 凭据。本报告不把接受服务器的可达性等同于产品验收已发布。

## 环境与启动入口

- Worktree：`/home/hardy/Workspace/LobeHub/lobehub-t128`
- 分支：`fix/compression-threshold-measured-usage`
- 开始时 HEAD：`1afe6859f38c6784872042136cb89bd4fde19213`
- 根目录 `.env` 不存在；`test-env.sh` 输出 `env files: none`。
- 启动入口：
  1. `.agents/acceptance/scripts/init-dev-env.sh setup-db`
  2. `.agents/acceptance/scripts/init-dev-env.sh s3`（项目脚本遇到依赖 API 漂移失败；使用已安装锁定版 parser 的临时适配启动同版本 s3rver，详见证据）
  3. `.agents/acceptance/scripts/init-dev-env.sh seed-user`
  4. `.agents/acceptance/scripts/init-dev-env.sh qstash`
  5. `eval "$(.agents/acceptance/scripts/init-dev-env.sh env --exports)" && exec bun run dev`
  6. `.agents/acceptance/scripts/init-dev-env.sh preflight`
- 端口由 `.agents/acceptance/scripts/test-env.sh` 与 `.records/env/agent-testing-ports.env` 解析：APP_URL/SERVER_URL `http://localhost:38518`，SPA `28359`，DB 实际迁移端口 `5044`；Redis、QStash、S3 分别为 `6380`、`8080`、`29000`。未按静态端口表猜测应用端口。
- 账号由 `seed-user` 创建；脱敏后的 `lh whoami --json` 返回 user `user_agent_testing_001`、email `agent-testing@lobehub.com`、personal scope。密码和 API key 不写入报告。
- `preflight` 实际结果：Redis、QStash、S3 read/write/delete、dev server 全部通过。

## 情形 A：实测用量基线参与压缩判定

**状态：blocked（未得到 Provider 调用结果）。** 对本地 Lobe AI agent 执行：

```sh
(unset LOBEHUB_JWT; source .records/env/agent-testing-cli.env; \
 lh agent run -a agt_KOcjlmpbUIZL -p '请仅回复“验收连接确认”。' --json --timeout 60)
```

CLI 事件状态：`idle · 0 step(s)` → `error · 1 step(s)`；最终 `Run error: InvalidProviderAPIKey`，exit code 1。对 `openai` 和 `deepseek` 执行 `lh provider view` 均显示本地账号的 provider `config` 为空（原始脱敏结果见 `t3-evidence/01-environment-and-runtime.txt`）。因此表中事实如下：

| 字段 | 实际值 |
|---|---|
| operation 状态 | `error`（无成功模型 step）|
| `{msgId,tokens,model}` | 未产生/未观察到 |
| baseline | 无 |
| 增量估计 | 无判定记录 |
| threshold | 无判定记录 |
| needsCompression | 无判定记录 |
| Provider 实际 usage / 费用 | 无 Provider 响应；无账单对照 |

**结论：**不能据本轮证据判断 baseline 分支在真实产品对话中生效。此处是前置凭据缺失，不是压缩判定失败的证据。

## 情形 B：锚点缺失时退回全量估计

**状态：blocked（未运行到压缩判定）。** 首轮需要成功 Provider 响应后的实际判定数据，或有效会话中压缩后锚点缺失的运行数据。本轮模型请求即失败，operation 没有任何模型 step，所以没有全量估值、threshold 或 `needsCompression` 的实值。不能将测试 fixture 或代码预期替代真实对话证据。

## 已实测事实与未验证范围

已实测：

- `setup-db` 成功创建 Postgres/Redis 容器并执行 migration。
- QStash、S3 与本地全栈服务启动后，`init-dev-env.sh preflight` 所有 agent-runtime 前置条件通过。
- Seed user 登录 CLI 成功；本地 Agent Runtime operation 因 `InvalidProviderAPIKey` 结束。
- 清理后本轮启动的 Web/全栈服务、QStash 和 S3 不再监听；DB/Redis 和 S3 数据保留，符合 PROJECT.md `clean` 的保留约定。
- 证据文件 `t3-evidence/01-environment-and-runtime.txt`、`t3-evidence/02-service-start-and-clean.txt` 记录原始命令及关键输出摘录。

未验证：

- 真实 Provider usage 的记录和 `{msgId,tokens,model}` operation 锚点。
- 实测 baseline + 增量估算、threshold 与 `needsCompression` 的真实判定值及对应 Provider usage/计费对照。
- 首轮或压缩后无锚点情况下的真实全量估计回退。
- 多 Provider/多模型一致性；大窗口模型压力、长对话和压缩后生命周期验证。
- 正式 Acceptance ingest 和可访问的发布链接；本轮没有成功产品案例可供发布。

## 清理与工作区

执行 `.agents/acceptance/scripts/init-dev-env.sh clean`。该命令报告未找到其自身登记的 dev-server PID state，因为本轮为加载 no-`.env` 引导环境通过 resolver 执行 `bun run dev`；随后只终止本轮启动的全栈、QStash 与 S3 shell。未停止用户或其他 worktree 的服务，也未执行 `clean-db`/`clean-s3`。本轮 acceptance guard 已停止。清理后的 QStash/S3 HTTP 探测均为连接失败；最终 `git status` 干净。

资源 guard 采集 118 个样本，因主机 swap 100% 均记为 red，故已在重试真实对话前停止验证。详见 `t3-evidence/02-service-start-and-clean.txt`。

## 证据索引

| 结论 | 证据 |
|---|---|
| no-`.env`、worktree、端口解析和 stack preflight | `t3-evidence/01-environment-and-runtime.txt` |
| CLI 真实 Agent Runtime 请求失败、Provider config 为空 | `t3-evidence/01-environment-and-runtime.txt` |
| 启停服务、clean 结果、guard 状态、停止验证 | `t3-evidence/02-service-start-and-clean.txt` |
| 验收标准与 requiredEvidence | 本 Task 冻结 Acceptance plan；本轮判据见提交给 run 的证据 |

## 建议下一步

为这个隔离的 seed user 配置一个可用、允许真实调用的 Provider 凭据（通过本地产品受支持的凭据注入/设置路径，不要在报告或聊天中披露密钥），并确认该模型返回输入 token usage。随后在相同 Task worktree 用全新 acceptance round 重跑两种情形，保留 operation trace、判定结构日志和 Provider 原始 usage，并完成对应发布/关联流程。之后再评估大窗口模型压力覆盖。

## 第 3 轮补充：按上一轮缺口复核

本轮复核了真实 worktree、三份原始证据文件和产品验收流程。报告前文中的“清理后本轮启动的服务已停止”只由清理后端口探测失败支持，不能证明停止对象与本次启动实例的 PID/启动时间/工作目录绑定。原始 `02-service-start-and-clean.txt` 明确记载 `init-dev-env.sh clean` 未找到它登记的 dev PID state；也没有保存本轮 dev、QStash、S3 的 PID、启动时间、命令行和工作目录核对表。因此，本报告撤回“已证明只停止本次启动进程”的强结论：本地进程停止是此前操作记录，实例归属核对证据不足，清理范围在此项仍未验证。清理后的探测失败只能证明当时目标端口不可连接，不能排除误停或其他同实例情形。

本轮没有重新启动服务：唯一已知 seeded Provider 配置为空，上一轮真实 Agent Runtime 对话在调用模型前返回 `InvalidProviderAPIKey`；本轮没有可用的隔离 Provider 凭据，也不能凭空生成 Provider 实际 usage。已有证据明确没有 `{msgId,tokens,model}`、baseline、增量估值、threshold、`needsCompression` 或 Provider 计费对照；两种判定场景均未运行至压缩判定。不能把失败调用、测试或代码推断视作场景证据。

### 本轮边界与发布

- 本地运行证据已采集，但两种产品行为的决定性证据缺失，因此不能宣称 T-130 的两种行为验收完成。
- 发布链接缺失：没有成功的产品验收 round 可发布；本轮也未伪造或借用无关 round 的链接。
- 已实测范围仍限于 no-`.env` 环境启动/preflight、CLI operation 的 `InvalidProviderAPIKey` 错误，以及既有清理后端口不可连接记录。
- 实测 baseline 分支、缺锚点全量估计回退、实际 Provider usage/费用关联、多个 Provider/模型和大窗口压力均未验证。
- 因没有重新启动，当前没有本轮新启进程需要清理。既有上轮进程归属证据缺口仍然开放；不得将本轮的空进程列表解释为补齐了历史 PID 证据。

### 本轮可交付原件

报告目录中的原始证据文件仍随工作树存在：`t3-evidence/01-environment-and-runtime.txt`、`t3-evidence/02-service-start-and-clean.txt`、`t3-evidence/03-publication-preflight.txt`。本报告的环境和失败结果由 01 支持；服务启动及“PID 绑定证据缺失”的事实由 02 支持；发布链接缺失由 03 支持。相关内容与本轮报告正文均已整理到 LobeHub Agent 文档，供不具备该 worktree 访问权限的审阅者直接核对。
