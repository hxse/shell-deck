# Execution Plan

## 阶段一：统一图标真值

扩展 `MacroIconButton.svelte` 的current insert kinds与`+↑` / `+↓` SVG，统一Move的默认accessible name。让 `NodeActionControls.svelte` 删除两段本地SVG并复用共享组件；让For text-list切换到同一before/after语义。

## 阶段二：测试与current docs

新增轻量source-contract unit，证明旧kind和重复SVG退出；更新既有Macro E2E的accessible name断言并继续通过真实click验证插入位置。同步 `macro_template_contract.md`；Quickstart只说明新glyph含义并登记focused验证入口，其他使用流程不变。

## 阶段三：顺序Gate与审阅

依次运行task-focused unit/E2E、`just check`、`just build`、file-size和diff-check。最后审阅当前change相对`20260724D`的完整diff，回填`04_review`与task index，并确认`conflict=false`。
