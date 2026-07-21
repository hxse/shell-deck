# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* Macro New/Select/Edit/Save/Delete/Copy、visual/JSON切换与dirty提示冻结。
* selection和未保存draft保持browser-local；成功Save/Delete后的record invalidation保持user-global。
* content edit lease、controller guard、expected revision、takeover/read-only与reacquire冻结。
* operation pending、generation/draft identity复核、published Create preservation和beforeunload冻结。
* explicit `Prepare terminals`、Start/Pause/Resume/Stop、Running Macro snapshot和runtime input冻结。
* remote Save/Delete、reconnect reconciliation、own ack与queued invalidation replay冻结。
* 所有按钮、文案、toast、DOM、focus与test id冻结。

### Primary file

`src/lib/components/MacroPanel.svelte`。

## 任务规范

### 目标模块

* `macroRecordSession.svelte.ts`：list/selection、draft identity/revision、dirty、controller/content lease、CRUD、published Create preservation与unload状态。
* `macroJsonEditSession.svelte.ts`：JSON text buffer、validate candidate、pending commit和Cancel/Save原子安装。
* `macroInvalidationQueue.ts`：content event watermark、pending buffer、own ack/higher revision/delete分类与bounded retry outcome。
* `macroRunnerSession.svelte.ts`：Prepare request identity、Start/Pause/Resume/Stop、Room shared running snapshot和runtime input client interaction。
* `MacroPanel.svelte`：现有view composition、局部UI state和session command绑定。

### Ownership

* `macroRecordSession`是editing/viewing Macro唯一owner；runner session只能读取明确snapshot，不可改selection/draft。
* JSON session拥有text buffer；server成功前不得替换visual draft或关闭buffer。
* invalidation queue不直接写UI state，只产生按record/revision分类的decision，由record session原子应用。
* runner shared snapshot来自Workspace props；session不建立第二轮polling或复制server state machine。

### Async operation identity

每个lock-sensitive operation捕获operation generation、record key/revision、draft identity/revision、controller epoch和edit lease id。每个await后按当前contract复核；stale continuation只能reconcile已发布authoritative result，不能覆盖较新local state或恢复旧lease。

### 明确禁止

* Macro/Library共享一个带feature flags的generic session。
* 把session放成module singleton。
* 用disabled/inert吞掉shared mutation feedback。
* 为简化invalidations而在focus/interval全量覆盖dirty draft。

## 示例

### 合法

A执行Create，server已发布但response延迟；B取得fresh lease并Save/Delete。A收到response后由record session关联fresh identity并保留submitted buffer，queue随后显示准确remote notice，不覆盖buffer，unload guard持续有效。

### 非法

Save函数在组件中保留一半identity检查，另一半移到session；两边各自递增generation，形成无法证明的双owner。

## 测试

### Unit/session

* operation identity、stale response、own ack、higher revision/delete replay、retry和preservation状态转换。
* JSON candidate在409/500/lease loss时保持buffer与editing。
* completed/failed/stopped释放run structure UI lock但不丢合法edit lease。

### Browser E2E

* current Macro CRUD/visual/JSON/Copy/Prepare/run/input完整journey不变。
* 双标签takeover、delayed Save/Create、remote Save/Delete、reconnect和beforeunload races不变。
* observer点击shared mutation仍得到统一toast，不出现静默disabled。
* Macro selector、chrome、editor和Trace的DOM/button inventory无漂移。

### Gate

运行Macro validation/unit、Macro HTTP/runner integration、`.034/.035/.037` E2E、current comprehensive UI、`just check`、build与`git diff --check`。
