# 20260725A Review and Verification

## 总体判断

本轮同时审阅代码和文档。Macro插入方向已经从两套相反的“横线 + 加号”收口为一套共享`+↑` / `+↓`语言；Flow、Parallel与For text-list的真实插入位置、按钮顺序、focus/palette、test id和主题样式保持。未发现未解决P1/P2/P3或需要人工拍板的问题，Formal Document、Code、Test、Current Docs与Close Gate通过。

## Gate 结论

| Gate | 结果 |
| --- | --- |
| Task-focused unit/source oracle | 12项通过 |
| Task-focused Chromium E2E | 2项通过 |
| `just check` | 通过；TypeScript/Svelte 0 error、0 warning |
| Production build | 通过；403 modules |
| Full unit入口 | 268 unit（含6项theme foundation）+ 55 integration通过 |
| Full Chromium E2E | 59项通过，单worker |
| Project file-size | 347个project-authored code文件全部不超过400行，0 exception |
| Diff check | 通过 |
| jj conflict | `qtqkpyrt`为`conflict=false` |

## Findings and Solutions

### 1. P2 / L1：before/after插入图标使用了相反的视觉定义

`NodeActionControls`原来的`Add before`是横线在上、加号在下，视觉上等同于For text-list的`Insert below`；`Add after`又等同于`Insert above`。同一图形在不同位置表达相反操作，用户只能依赖按钮顺序或tooltip猜测。

已把共享`MacroIconButton`的current kind收口为`insert-before`和`insert-after`，分别绘制`+↑`和`+↓`。`NodeActionControls`删除两段本地button/SVG并通过共享组件输出全部六个结构按钮；For text-list同步改用before/after语义。旧kind不保留alias。

Focused source oracle冻结两种glyph path、共享组件顺序和重复SVG退出；E2E逐项验证Flow与Parallel accessible name、For当前index/index+1插入，以及Parallel before/after形成`wait / capture-source / wait`的真实顺序。

### 2. P3 / L1：结构oracle仍冻结旧重复元素数量

删除两组本地SVG后，workbench source inventory从752项降为744项，project current structure从855项降为847项。初次focused Gate按预期阻断，证明旧oracle没有被静默绕过。

已只更新current fingerprint与三处有意component digest；历史`20260722A.002` baseline未修改。随后focused、完整unit和完整E2E均通过。

## 需要人工拍板

无。图标语言已由用户明确指定为`↑`、`↓`、`+↑`、`+↓`。

## AI 可直接修

上述两项均已修复并通过完整验证。

## 未覆盖与残余风险

没有新增像素截图baseline；glyph本身由exact SVG source oracle冻结，语义与点击位置由Chromium E2E验证。不同系统的原生font不会影响图形，因为加号和箭头都由SVG path绘制。

## 审阅范围

审阅`qtqkpyrt`相对父change `nkysvnvm`的全部代码、task文档、active spec、Quickstart、focused入口、source/structure oracle与E2E delta。确认未改变Macro schema、draft mutation、insertion anchor、button order、test id、DaisyUI class、focus/Escape或Text terminal协议。
