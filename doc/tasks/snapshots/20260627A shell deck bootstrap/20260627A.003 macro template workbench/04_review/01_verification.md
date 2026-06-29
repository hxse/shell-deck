# Verification

## Automated Gate

已在 `20260627A.003 macro template workbench` 工作区运行并通过：

```bash
just check
just test-unit
just test-e2e
just test-003
git diff --check
```

覆盖范围：

* `ProfileCatalogSummary` thin stub schema，并拒绝 prompt/schema/fixtures/model/replicas 等完整 ParserProfile 字段。
* macro template schema validation、TerminalRef validation、structured BranchCondition validation；branch condition 只允许 `signal/op/value/goto`，拒绝 `if`、`expression` 等字符串表达式变体。
* regex parser rule validation、禁止 Codex session 字段、禁止 `.003` 保存 parser prompt/schema/fixtures/model。
* template store save/read/duplicate/import/list round trip；旧 `terminalAliases` / 顶层 `captureSources` 模板在 read/import 时自动迁移到 terminal tab alias/ref 和 `capture-source` step。
* 浏览器 macro panel 创建模板、通过 terminal tab rename 产生 alias、用 alias 选择 terminal、添加 `send_line`、`sleep`、`input_line`、`capture-source`、regex `parse`、structured `branch`、`goto + loopGuard`、`fail`、`stop`，保存、刷新恢复、导出并重新导入。
* 浏览器 macro panel 覆盖 Editor/JSON tab 切换、JSON 不在 Editor 下方渲染、顶部 run controls 可点击并在 `.003` 给出明确状态反馈、`capture-source` step 和 `parse.captureStep` 默认非空、空 workspace 可直接 Import，Import/Export 在同一 action bar；删除模板必须经过 confirm 且 cancel 不删除。
* 现有 terminal deck browser e2e 仍通过，并覆盖 xterm 填满 terminal host、背景一致、tab alias rename、拖拽开关和多 tab 同步。

## Manual Smoke

可选记录。`.003` Close Gate 以自动化 gate 为准；人工测试用于补充 UX 反馈，不是必须阻断项。
