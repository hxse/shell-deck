# Execution Plan

## Change链

root change只保存blueprint、context、index与预审结论。`.001-.004`分别建立独立`jj change`；每个child完成code/doc/test review后才创建下一个child。

## 实施顺序

### `.001` Terminal Room

冻结manager public surface和callback ordering；抽control plane coordinator，再抽backend/cwd coordinator；manager保留Room registry、per-Room serialized owner、public facade与broadcast wiring。验证controller/heartbeat/mutation/PTY/replay/lifecycle focused Gate。

### `.002` Macro record

冻结factory return surface、rune owner与async identity；抽Macro-specific mutation workflow和remote sync decision coordinator，保留session中唯一state与UI feedback commit。验证CRUD/lease/race/reconnect/published-Create Gate。

### `.003` Library record

沿用同一拆分原则但不复用Macro实现；抽Library-specific mutation workflow和remote sync coordinator，保留navigation/search/selection的Library contract。验证CRUD/navigation/race/reconnect Gate。

### `.004` Macro editor

先把placement/focus/Escape/restore-focus生命周期收口到`MacroInsertionPalette.svelte`，再抽flow tree和parallel lane controller；保留既有markup、control order和mutation callbacks。验证structure fingerprint、keyboard/focus、narrow viewport、recursive/lane mutation与完整Macro browser journey。

## 每个child共同步骤

1. 记录当前public surface、state owner与focused baseline。
2. 先建立module-boundary/characterization test，不改产品行为。
3. 机械移动一类职责并删除旧实现。
4. 扫描dependency direction、cycle、duplicate implementation和unexpected consumer。
5. 运行focused Gate、static/build/diff Gate并回填review。
6. `jj status/log`确认`conflict=false`后才创建下一个change。

## Closeout

`.004`完成后执行full unit/integration/E2E和整链static audit；同步`active_specs/shell_deck_architecture.md`、Room/Macro/Library相关active contract及root review/index。任何失败先归因到最早引入该ownership变化的child。
