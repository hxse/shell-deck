# Result

## 当前状态

`.026` 的 hard-cut schema、runner/cursor binding、S1-S6 editor、A1-A6 adaptive textarea、Current Docs 同步和自动化验证均已完成。当前 change 无未解决 P1/P2，正式 Close Gate 通过。

当前设计真值已同步到 `doc/tasks/active_specs/macro_template_contract.md`、`doc/tasks/active_specs/run_log_contract.md` 和 `doc/guides/001_quickstart.md`；本 task `02_spec` 保留本次设计快照与验收边界。`.025` snapshot 仍是历史证据，不回写。

## 实际修改

### Hard-cut schema 与 template grammar

* `text-list.items` 唯一合法 shape 已替换为非空 `{ key: string, value: string }[]`；index 由数组位置生成，不进入 JSON。
* Validator 只接受 item 自有的 `key` / `value` 两个字段；key 保留空值、重复、Unicode 和首尾空白，但拒绝 CR/LF；value 按 byte-preserving string 处理并允许 multiline。
* 旧 `items:string[]`、mixed array、`entry-list`、unknown field 和 alias/migration/Convert 路径全部拒绝，不提供读取、rewrite 或 dual schema。
* Template grammar 唯一接受 exact `{{index}}`、`{{key}}`、`{{value}}`；`{{text}}` 在 template mode fail loudly。
* Renderer 对原始 template 做一次 union callback scan；replacement 中的 token 不递归展开，ordinary literal 中的双花括号保持原字符。

### Runner、cursor 与 resume

* 每轮构造 immutable `{ index, key, value, forStepId }` binding；模板 index 是纯 1-based 十进制字符串，execution path 和内部 loop cursor 继续 zero-based。
* if/elif/else、control body、count/forever 和 parallel lane 继承最近 binding；nested text-list 原子 shadow 三个值，退出后恢复外层。
* Cursor snapshot/restore 保存完整 binding；wait、input、capture、notify 和 parallel resume 从准确 dynamic occurrence 继续，不重放已经完成的 side effect。
* `loop_iteration_*` 事件继续记录 zero-based `iterationIndex` 与 one-based `iteration`，后者与渲染后的 `{{index}}` 对齐；没有增加独立 key/value snapshot 字段。

### Editor 与 surface whitelist

* Text-list item card 显示纯数字 index、单行 Key 和 adaptive multiline Value；Add/Remove/Up/Down 原子移动 key/value。
* S1-S6 保持唯一 template capability whitelist，统一显示 `Use loop template` 和三个 Insert controls；source key/value 不提供 checkbox。
* S5 input.prompt 与 S6 user-continue prompt 改为 multiline；notify.title 仍是 template-capable single-line。
* 非 S1-S6 字段继续保持原 schema/control；普通 text 中的 `{{index}}`、`{{key}}`、`{{value}}` 和 `{{text}}` 都是 literal。

### Adaptive textarea

* A1-A6 共用一个 adaptive implementation，按当前宽度的实际 `scrollHeight + one line` 自动增长；message/value/prompt/description 自动上限为 3 行，runtime input 为 4 行。
* 达到 auto cap 后使用内部滚动；保留 native `resize: vertical`，temporary manual height 可突破 auto cap，但统一 clamp 到 60vh。
* 手动放大只在组件生命周期内存中存在，不写 macro JSON、run state 或 localStorage；普通输入不清除，remount/reload 后恢复自动高度。
* Item/part 结构操作会 remount 对应 adaptive editor，防止某一内容的 temporary manual height 串到重排后占据相同位置的另一内容。

### 项目规则与 Current Docs

* `AGENTS.md` 新增 current-schema-only 默认原则：优先破坏性替换，不兼容、不读取、不处理旧语法；除非具体 task 由用户明确要求，不得添加 alias、migration、dual schema、legacy branch 或自动转换。
* 同步 macro template active spec、run-log active spec、quickstart 和 task index；`.025` snapshot 保持不变。
* 新增 `just test-026` / `test:026` focused Gate。

## Post-review 修复

* **P2（AI 直接修）**：初版 item/message-part list 复用 position component state，重排后可能把 A 的 temporary manual height 带给 B。结构操作现在 bump local structure version 并 keyed remount；普通文本输入不 remount。新增可区分旧实现的 E2E。
* **P3（AI 直接修）**：schema 的 key/value presence check 改为 own-field check，并补 inherited property regression。
* **P3（AI 直接修）**：adaptive editor 补 template-mode/toolbar effect dependency、`document.fonts.ready/loadingdone` remeasure、同步首测和 pointer-only manual detection，避免 ResizeObserver 把程序性高度误判为用户拖拽。
* **P3（AI 直接修）**：E2E 改为按 computed line-height、padding 和 border 验证 row cap，并断言 `resize: vertical`、soft wrap、60vh clamp 与结构重排后的 manual-state reset。

上述 finding 均已在当前 change 修复；没有需要用户拍板的项目。

## 验证结果

| 命令 | 结果 |
| --- | --- |
| `just test-026` | 通过：134 个 Bun tests、0 fail、576 expect；2 个 Chromium E2E 通过 |
| `just check` | 通过：svelte-check 0 errors、0 warnings |
| `just test-unit` | 通过：239 pass、0 fail、992 expect |
| `git diff --check` | 通过 |
| `.orig/.rej` 扫描 | 无残留文件 |

本机受限执行环境缺少 Chromium 的动态库搜索路径；最终 E2E 使用当前 Nix system libraries 运行并通过。Vite build 仍输出 `>500 kB` chunk-size advisory，不影响本任务 correctness，作为 P3 bundle/code-splitting 候选保留。

## Legacy Kill List 结果

* 生产 schema、renderer、runner 和 editor 不存在旧 `{{text}}` token、string text-list item、`entry-list`、alias/migration/Convert 分支。
* Store read/import 和 runner preflight 对旧 string items 与 template-mode `{{text}}` 都 fail loudly。
* Index 不进入 JSON、key/value 不进入 execution identity，且没有 compatibility adapter。
* S1-S6 与 A1-A6 都是显式 whitelist，没有按“所有 string/textarea”扩散能力。
* Active specs、quickstart、task index 与测试 fixture 已按唯一新 contract 同步；仓库无 `.orig/.rej` 残留。

## 残余风险与范围外

* Browser E2E 用 inline height 加 synthetic pointer boundary 模拟 native resize，另有 computed `resize: vertical` 断言；没有自动拖动浏览器 resize handle。
* 运行时任意 CSS `font-size` / `line-height` 热切换没有独立 observer；当前产品没有该动态入口，width、viewport、template mode 和 font loading 已覆盖。
* Cursor 的 server restart/crash、第三方 terminal session 恢复与 exactly-once crash window 仍沿用 `.025` 的明确范围外。
* Vite chunk-size advisory 作为非阻断 P3 保留。

## Close Gate 结论

文档 Gate、Schema/Runner/Editor Execution Gate、AI post-review、Legacy Kill List、Current Docs Gate 和正式自动化验证均已完成。当前无未解决 P1/P2；在上述明确 P3 advisory 与范围外限制下，`20260627A.026` Close Gate 通过。
