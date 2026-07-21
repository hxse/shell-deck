# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* Directory/Global和Prompt/Note/Macro JSON tab、selector、search与sort行为冻结。
* canonical identity `(kind,itemId)`、revision、content lease和controller guard冻结。
* New/Edit/Save/Delete/Cancel/Copy/Validate/Load into Macro行为冻结。
* navigation pending/inert、operation generation、stale continuation和feedback优先级冻结。
* remote Save/Delete、own ack、reconnect、published Create preservation、Discard local copy与beforeunload冻结。
* browser-local selection/draft不共享；saved content同步的边界冻结。
* UI DOM、样式、文案、按钮顺序、focus与test id冻结。

### Primary file

`src/lib/components/LibraryPanel.svelte`。

## 任务规范

### 目标模块

* `librarySession.svelte.ts`：当前scope/kind/record、draft identity/revision、dirty/editing、lease、CRUD、preservation和dirty reporting。
* `libraryNavigationCoordinator.ts`：tab/select/New/Edit/Cancel/Refresh的串行operation、lease release和stale continuation decision。
* `libraryInvalidationQueue.ts`：content event watermark/buffer、own ack、higher revision/delete与retry outcome。
* search request的kind/query snapshot与stale compare保留在session局部，不为二字段投影建立独立模块；session仍不拥有server-side search结果真值。
* `LibraryPanel.svelte`：现有UI composition、field binding与command feedback。

### Ownership与ordering

* session是selection/draft/edit lease唯一owner；navigation coordinator只能提交带完整captured identity的decision。
* operation入口先稳定判断`operation_pending`，再判断controller/lease，保持统一feedback。
* await lease release前立即进入pending；任何continuation提交前复核operation、scope、kind、selection和draft identity。
* pending invalidation必须buffer并在settle后按revision/operation顺序replay；transport/5xx不推进watermark。
* published Create未保住fresh lease时，独立preservation state参与remote handler、selection clear与unload guard；只有显式resolution解除。

### 与Macro的边界

只允许复用底层HTTP client、toast和纯validation gateway。不得复用Macro record session，因为Macro拥有Prepare/runner/JSON visual duality，Library拥有scope/kind/search/Load语义。

## 示例

### 合法

用户点切换Note，lease DELETE延迟，随后点New。统一navigation domain阻止第二个mutation或令旧continuation stale，绝不会在New完成后执行`draft=null`。

### 非法

* `changeKind`自行pending，`selectByKey`另用一个boolean，New绕开二者。
* remote event先推进watermark，读取500后丢弃。
* preserved Create点击Cancel后安装旧response snapshot而不重读server truth。

## 测试

### Unit/session

* navigation generation、lease release race、Save/Create identity与feedback priority。
* own ack/higher revision/delete queue replay、one-shot failure retry和reconnect reconciliation。
* preservation的Save/Delete/Discard/Select/New/Refresh及dirty reporting。

### Browser E2E

* 三kind、两scope、search/tags、CRUD、Copy、Validate、Load完整journey不变。
* delayed lease DELETE、Save/Create response、takeover、remote Save/Delete和beforeunload race确定性通过。
* stale lease status不出现在新selection；readonly写入有toast。
* DOM/button inventory和视觉布局不漂移。

### Gate

运行Library unit/HTTP integration、`.036/.037` E2E、双标签content race、current comprehensive UI、`just check`、build与`git diff --check`。
