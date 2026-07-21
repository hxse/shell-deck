# 20260721A Behavior-Preserving Large-File Decomposition

## 任务概括

在20260627A.039形成的current产品状态上，规划一条纯结构重构链，把职责过多、长期难维护的server、Svelte组件、validator、runner、CSS和current test journey拆成边界清晰的小模块。

本主任务只保存规划蓝图，不直接规定每个函数如何移动，也不实施代码。具体文件边界、冻结语义、回归测试和停止条件由.001-.010各自的正式spec负责。

## 正式 task 级别及定级原因

三星任务。

十个子任务横跨HTTP、Room state、Macro/Library编辑会话、runner、terminal runtime与测试体系。单个子任务只做局部拆分，但整个序列必须避免跨change漂移、循环依赖、状态真值分叉和UI意外重写，因此需要完整Document/Code/Test Gate。

## 范围内

* 识别当前真正值得拆分的大文件，并按稳定职责边界安排十个串行子任务。
* 冻结“behavior-preserving refactor”：外部可观察行为必须与20260627A.039基线等价；其中AgentEvent exact wait-limit专项继续以20260627A.038为语义来源。
* 规定每个子任务只拆一个高内聚区域，先建立机械回归证据，再移动实现。
* 保留公开facade，使调用方迁移范围受控，避免一次性全仓重写。
* 最后拆分current tests，使测试文件结构与产品职责一致，同时保持断言覆盖。

## 范围外

* 不新增、删除或改变产品功能。
* 不改变MacroDefinitionV5、AgentEvent exact wait-limit、HTTP/WebSocket协议、错误码、持久化格式或current-schema-only策略。
* 不改变UI布局、视觉语言、文案、DOM行为、键盘/焦点语义或test id。
* 不趁拆分清理看似重复但可能承载时序语义的代码。
* 不修改冻结的20260627A.031B历史基线。
* 不建立generic framework、service locator、全局event bus或兼容adapter。

## 决策归属

人工已拍板：本轮只做拆分；主任务独立一个jj change，每个子任务再独立一个jj change；当前阶段所有change只写文档。

AI可在后续按各子任务spec实施机械拆分与测试。任何无法证明行为等价的设计变化必须停止并另开正式任务，不得夹带进入本任务链。
