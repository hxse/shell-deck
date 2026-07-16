# Contract

## 任务边界

`.031B` 的 parent behavior truth 是 `.031A` revision `1236af61`。本任务主要新增测试、测试清单、无视觉影响的 test identity，以及运行这些测试所需的离线 test harness；不得改变 Macro schema、runner、terminal protocol、storage 或既有产品 contract。

完整 journey 若稳定复现了与 `.031A` active spec 直接矛盾的实现缺陷，可以做最小 contract-conformance 修复，但必须同时满足：

* 已有 active spec 或 `.031A` task 明确写出预期行为，不由 `.031B` 新增产品取舍；
* 修改只触及造成违约的局部实现；
* `04_review` 记录 finding、根因和回归证据；
* source inventory 与完整 journey 都继续通过。

Gate 必须满足：

* `just check`
* `just build`
* `just test-031`
* `just test-031b`
* `git diff --check`

## 基线冻结与后续更新

### 冻结规则

`.031B` revision 内的 inventory、journey 和断言必须描述 `.031A` 的行为，不得引用尚未落地的 `.032+` contract 作为期望。

### 后续更新规则

后续 change 可以修改 `.031B` 测试，但每项产品语义变更必须在 inventory/manifest 中带：

* `changedBy`: owning task id；
* `.031A` old behavior；
* new behavior；
* 对应 spec 路径或稳定章节名；
* 为什么该变化属于 contract change，而不是实现漂移。

纯 selector、DOM nesting、component rename 或测试便利性变化不得降低 semantic coverage。若后续只重构实现，既有行为断言必须保持。

删除 control 时必须把原 inventory entry 改成 attributed removal，而不是静默删除历史；新增 control 必须先登记再通过 Gate。

## 完全离线

* server 只绑定 loopback，AI JSON parser 使用 `disabled`。
* 使用 isolated `SHELL_DECK_DATA_ROOT` 和唯一 config id。
* 禁止任何外部 HTTP、WebSocket、model、Telegram 或 Codex 调用。
* real shell 仅执行固定、无网络、无持久副作用的命令，例如 `printf`、`pwd`。
* `agent-event`、Codex Agent/Mode controls 和 Codex hook 明确排除。
* notification UI 可以测试 app/system channel 与本地 sound；Telegram control 可以验证 toggle/profile UI 后在运行前关闭，不能发送 Telegram。

## UI-only mutation

核心 journey 不得通过 Playwright `request`、直接 `fetch`、WebSocket frame 注入或 server store helper 创建/修改以下对象：

* terminal；
* Macro template；
* Prompt；
* run / runner state；
* artifact / event。

允许的 harness 行为只有：

* 打开唯一 config URL；
* grant clipboard/notification 等 browser permission；
* 监听 download；
* 读取 clipboard、download 文件和 DOM 作为断言；
* 为验证 offline contract 拦截并拒绝非 loopback request；
* 使用浏览器 keyboard/mouse/drag/file chooser 操作真实 UI。

Macro Import 只能读取同一旅程通过 Macro Export 按钮得到的文件，不得使用手写 JSON fixture替代 visual creation。

## Interactive control inventory

### Source audit

审计范围包括 `src/App.svelte` 与 `src/lib/components/**/*.svelte` 中的：

* `<button>`；
* `MacroIconButton`；
* `role=tab` / tab-like controls；
* `<summary>`；
* `<input>`、`<select>`、`<textarea>`；
* `role=separator`；
* draggable terminal tab；
* double-click rename surface。

每个 control 必须具有稳定 identity：优先 `data-testid`，其次稳定 `aria-label` / `title` / literal accessible name。只有 Codex / `agent-event` controls 可以进入 exclusion，且 exclusion 必须写明原因。

source audit 发现未登记 control、inventory 指向已不存在 control、或 control 缺少稳定 identity时，Gate 失败。

### Runtime evidence

journey 必须为每个 required semantic control 记录一种 evidence：

* `clicked`：实际点击并验证结果；
* `edited`：实际输入/select/check/range/file/drag/resize；
* `boundary`：先断言 disabled/hidden，再在可用状态实际操作；
* `excluded`：仅限 spec 明确排除的 Codex / agent-event UI。

仅断言 visible 不算覆盖。重复实例可共享 semantic key，但至少一个实例必须实际操作；具有不同语义状态的同一 control 必须覆盖相应状态，例如：

* destructive confirm cancel 与 accept；
* collapse 与 expand；
* move disabled boundary 与 enabled move；
* JSON invalid Save、Cancel 与 valid Save；
* panel hide 与 show；
* rename Enter、Escape 和 blur；
* terminal close cancel 与 accept；
* insertion Cancel button、scrim 和 Escape；
* Prompt/Macro delete cancel 与 accept。

## 单一真实用户 journey

`tests/e2e/comprehensiveUiBehavior031B.spec.ts` 提供一个顶层 Playwright test，并用 `test.step` 分段。它必须从空 config 顺序完成以下矩阵。

### Workspace、Settings 与 terminal

* Macro/Prompt hide/show；
* Settings open、Close button、dismiss layer；
* insertion placement near/center；
* notification volume、local success sound；
* Drag toggle；
* Macro/Prompt panel resize 与 Reset width；
* New fake、New shell、New text；
* terminal tab mouse/keyboard selection；
* rename focus/caret、Enter、Escape、blur、invalid/duplicate error；
* drag reorder；
* terminal close cancel/accept；
* fake terminal direct input/output；
* real shell fixed offline command；
* Text multiline edit、line-number scroll、copy。

### Macro template chrome

* drawer open、Escape、dismiss layer；
* empty state、New、name/description；
* search/select；
* Save、Duplicate、Export、Import、Delete cancel/accept；
* Reset width；
* Editor/JSON/Trace tabs；
* operation/JSON dirty lock。

### Visual Macro editor

必须从 UI 插入并操作：

* actions: send、notify、input、wait、capture-source、extract_text、parallel；
* flow: if、for、finish、break、continue；
* empty `Add inside`；
* node collapse/expand、move up/down、add before/after、remove cancel/accept；
* main insertion Cancel button、scrim、Escape；
* Move existing；
* If 在没有 earlier artifact 时仍可插入并进入可编辑中间态；测试不得把“禁止插入”当正确行为；
* IF/ELIF/ELSE add/remove/collapse；
* for count/forever/text-list mode，discard cancel/accept；
* text-list add/move/remove、index/key/value；
* loop template toggle 与 `{{index}}` / `{{key}}` / `{{value}}` insert buttons；
* message Add Text/Add Source、part move/remove、source choice；
* send/input delivery help、delivery 与 ending options；
* wait duration/terminal-quiet/user-continue；
* capture terminal-buffer 与 text-box；不选择 agent-event；
* extract split/filter/select/extract/trim/on-empty；
* Parallel add/remove lane、lane tabs、lane/action id、action insertion/cancel/scrim、send/wait/capture/extract、action controls、Output source；
* notify level/on-failure/app/system/telegram toggles、app toast/sound；运行前关闭 Telegram。

### JSON

* read-only Copy 与 Export；
* Edit 后切换 Editor/Trace、template replacement 和 Start 被锁；
* malformed JSON Save 保留 buffer；
* schema-invalid JSON Save 保留 buffer；
* Cancel 恢复 preview；
* valid JSON Save 更新当前 template；
* edit textarea 与 line numbers/adaptive height 继续可用。

### Runner 与多 terminal capture

至少执行三次：

1. long/waiting run：Start、Pause、Resume、runtime Input Submit，最终完成；
2. stoppable run：Start 后 Stop；
3. final complex run：在两个及以上 terminal 输出不同 marker，分别 terminal-buffer/text-box capture，extract/if/parallel/for/template/notify 后完成。

最终 UI 必须证明：

* 多个 terminal 各自出现预期输出；
* run status 经历 running/waiting/paused/completed/stopped；
* Trace 中存在对应 node logs；
* artifact preview 可打开、关闭并包含 capture 内容；
* AI Trace 可切换并 Copy；
* runner Debug Refresh、Run Log Debug Refresh、New run、Append demo、run selector 都实际操作。

### Prompt

* project/global New；
* title/tags/body；
* Save、search、scope filter、select；
* Copy；
* scope move；
* dirty switch cancel/accept；
* Delete cancel/accept；
* multi-panel visibility 与宽度状态不被 Macro journey破坏。

## 稳定性

* 单个顶层 test timeout 可以单独提高，但所有 wait 必须基于可观测 UI state，不使用固定长 sleep。
* 每个 step 报错必须包含当前 semantic control 与 journey phase。
* browser console error、page error、unexpected dialog、非 loopback network request 直接失败。
* 下载、clipboard、notification permission 和 real shell 的环境差异必须在 harness 中显式处理，不能静默 skip。
* 测试失败保留 Playwright trace；不要求 screenshot baseline。

## 已知缺陷与预期失败

若 `.031A` 当前存在真实缺陷：

* 不得删掉对应 journey step；
* 在 review 中登记 stable finding id、复现步骤、owner change；
* 只有明确登记的 finding 可以使用 expected-failure ledger；
* ledger 必须精确到 scenario，不得把整个长 journey 标记为 expected fail；
* finding 在后续修复后，测试应先因“unexpected pass / ledger mismatch”提示更新，再由 owning change 删除对应 ledger entry。
