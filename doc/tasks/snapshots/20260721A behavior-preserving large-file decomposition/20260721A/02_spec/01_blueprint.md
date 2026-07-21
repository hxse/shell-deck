# Blueprint Contract

## 任务边界

### Added Semantics

无。20260721A不增加任何产品语义。

### Frozen Semantics

* 当前active specs与20260627A.039已经实现的用户行为全部冻结；其中AgentEvent exact wait-limit专项继续以20260627A.038为语义来源。
* HTTP/WebSocket、filesystem、MacroDefinitionV5及AgentEvent exact wait-limit、Room/controller/lease、runner、terminal replay和notification contract全部冻结。
* UI外观、组件交互、文案、可访问性、focus、keyboard、clipboard、toast和localStorage行为全部冻结。
* current tests的每一条用户journey和断言意图冻结；只允许按真实模块边界移动，不允许删弱断言。

### 子任务序列

1. `.001`拆HTTP server routing与transport。
2. `.002`拆Macro definition validation内部实现。
3. `.003`拆App的Room workspace state。
4. `.004`拆Macro panel编辑与运行会话。
5. `.005`拆Library panel编辑会话。
6. `.006`拆Macro visual flow editor。
7. `.007`拆Macro runner执行引擎。
8. `.008`拆Terminal Room manager。
9. `.009`拆Macro/Library workbench CSS。
10. `.010`拆current test journeys并做整链closeout。

子任务必须按序实施和重基。后继任务不得替前置任务修改同一ownership边界；发现前置边界错误时回到对应change修正。

## 任务规范

### 拆分原则

* 以state ownership、transaction boundary和public facade为第一边界，不按文件行数平均切块。
* 原入口文件保留薄facade和dependency wiring；新模块不得反向import入口形成cycle。
* state只允许一个owner。不得为了减少参数新增第二份cache、mirror state或browser-side truth。
* pure logic与I/O orchestration分开，但不改变原有调用顺序、await位置和错误传播。
* Svelte抽取优先使用Svelte 5 runes；不得借抽取把本地会话提升为全局store。
* 不新增compatibility、normalizer、alias、migration或dual implementation。

### 每个change的硬限制

* 一个change只处理对应子任务spec列出的primary files和必要的直接调用适配。
* 不做顺手命名重写、视觉清理、算法替换或性能优化。
* production导出与测试helper都必须有明确consumer；禁止建立抽象层后仍保留两套实现。
* 若机械移动暴露真实bug，先记录并在原功能task或新正式task修复；本重构change不静默改变行为。

### 不纳入本轮拆分

`server/evidenceStore.ts`、`server/contentEditLeaseService.ts`、`server/userDataRoot.ts`和`src/lib/protocol.ts`暂不拆。它们虽重要，但当前职责相对集中；本轮只允许因调用适配产生最小import变化。

## 示例

### 合法拆分

原入口保留公开函数和依赖装配，把纯route handler或pure validator移入单向依赖的新模块；调用返回值、错误、日志、事件、DOM和测试观察完全相同。

### 非法拆分

* 为统一Macro与Library而创建一个含大量feature flag的`GenericContentSession<T>`。
* 在移动route时顺便更改HTTP status或authorization顺序。
* 在拆CSS时合并selector、重排cascade或改变像素。
* 在拆test时删除race gate，仅保留happy path。

## 测试

### 每个子任务

* 先运行与primary file对应的focused Gate并保存基线。
* 拆分后运行相同Gate，结果和行为断言必须等价。
* 增加必要的module-boundary test，证明facade、ownership和无cycle约束。
* 运行`just check`、`just build`、相关unit/integration/E2E及`git diff --check`。

### 整链

`.010`必须从20260627A.031B历史基线到current journeys执行完整回归，并扫描：

* 无遗留duplicate implementation。
* 无新增legacy schema或compatibility branch。
* 无循环依赖和跨层反向import。
* 无UI snapshot、按钮inventory和用户journey意外漂移。
* 无build warning或测试warning被错误忽略。
