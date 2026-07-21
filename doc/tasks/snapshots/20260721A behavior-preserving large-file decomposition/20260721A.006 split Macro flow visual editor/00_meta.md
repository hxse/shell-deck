# 20260721A.006 Split Macro Flow Visual Editor

## 任务概括

把Macro visual flow editor的大型递归组件按node list、Action editor、control-flow editor、insertion palette、Capture/Extract fields、defaults和artifact choices拆开。拆分必须像机械搬移：用户看到的层级线、按钮、折叠、顺序、焦点、selector和warning完全不变。

## 正式 task 级别及定级原因

三星任务。

两个组件共同表达递归Flow、If branches、For body、Parallel lanes和artifact scope。抽组件容易改变DOM/cascade、事件冒泡、binding identity、focus或earlier choice计算，因此需要完整UI inventory和复杂纯UI dogfood Gate。

## 范围内

* 抽取递归node list与Action/control node editor。
* 统一复用现有插入palette、Capture Source、Extract Text字段实现。
* 抽取无UI的default node factory和artifact choice计算。
* 保留现有MacroEditorShell接口与draft mutation入口。

## 范围外

* 不改变Flow V2/MacroDefinitionV5 schema、AgentEvent exact wait-limit、validation、Unassigned与terminal layout authoring。
* 不增删按钮、字段、label、折叠层级或插入位置。
* 不改变现有缩进线、颜色、间距、图标和响应式布局。
* 不引入drag-and-drop、component registry或schema-driven generic form。
