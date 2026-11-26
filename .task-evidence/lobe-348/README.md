# P0-4 step state copy — 阻塞记录

状态：阻塞。不提交浅拷贝实现。

- 基线：`eca04fb6a89d99a3a15ce17ff163e5afe1b3a6a6`
- 失败实验：`packages/agent-runtime/src/core/runtime.stateIsolation.test.ts`
- 原因：浅拷贝让 runner 修改嵌套 input 后污染调用方 state，异常回滚失败；实测 `content` 从 `original` 变为 `changed`。
- 结论：保留 `structuredClone(state)` 以维持 runner/executor 输入隔离与异常回滚，直到有安全的最小方案。
- 原始测试输出：`shallow-failure.txt`
