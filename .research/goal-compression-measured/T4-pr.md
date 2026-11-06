# T4 PR 交付记录：实测用量压缩实现

## 目标与范围

本记录只覆盖 T-133：在 `fix/compression-threshold-measured-usage` 上按仓库约定提交一个以 `next` 为 base 的新 PR。它不把未完成的产品级压缩验收扩大为通过，也不代表整体 Goal 完成。

## 既定 PR 正文要点

- Contribution source：AI-assisted。
- 说明 provider 返回的实测 usage 如何成为压缩 baseline，并保留首轮、锚点缺失和模型不一致时的估算回退。
- 记录 agent-runtime 613 项测试、改动文件 check 的 161 项测试，以及修复前 4 失败/38 通过到修复后 42 通过的回归证据。
- 记录 `bun run type-check` exit 2；基线对照受依赖解析污染，不能宣称全仓类型检查通过。
- Acceptance 明确披露 T-130 已按 owner 决策豁免。最近一次产品尝试虽有 Provider usage 进入并落库，但压缩判定没有触发，因此没有取得 `{msgId,tokens,model}` 基线来证明压缩判定、baseline+增量、锚点缺失回退或账单对照。
- AI assistance 六个字段全部填写；未知元数据写 `unknown`。不声称 CI、人工 review、产品验收或发布链接已完成。
- 说明本 PR 是已关闭 #7 的新 PR，不复用旧 PR。

## 预创建核查原始结果

```text
worktree: /home/hardy/Workspace/LobeHub/lobehub-t128
branch: fix/compression-threshold-measured-usage
HEAD before final documentation commit: 1afe6859f38c6784872042136cb89bd4fde19213
origin/next: d985c9b286b52ce0b508a1367ad407edd3787a00
origin/next is ancestor of HEAD: yes
ahead/behind origin/next...HEAD: 0 8
working tree before T4: untracked T-130 report/evidence only
remote head before push: no fix/compression-threshold-measured-usage ref
closed PR #7: https://github.com/hardy-one/lobehub/pull/7

PR template: .github/PULL_REQUEST_TEMPLATE.md read
Admission script: .github/scripts/pr-admission-check.cjs read
Conflict-marker check: passed (git diff --check; no conflict markers)

Diff stat before T4 commit:
13 files changed, 1425 insertions(+), 3 deletions(-)

Quality evidence already recorded in T-129:
- agent-runtime: 33 files, 613 tests passed
- changed-file check: 6 files lint clean, 161 tests passed
- regression before: 3 files failed, 4 failed / 38 passed
- regression after: 3 files passed, 42 passed
- type-check: exit 2; baseline comparison polluted by shared dependency resolution
```

## 后续复核

PR 创建后，本文件将补充最终 HEAD SHA、`git diff --stat origin/next...HEAD`、正常 push 输出、`gh pr view --json number,url,state,baseRefName,headRefName,files,body` 原始校验结果、工作区清洁结果和未覆盖边界。