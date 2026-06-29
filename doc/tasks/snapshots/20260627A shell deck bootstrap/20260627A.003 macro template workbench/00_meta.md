# 20260627A.003 Macro Template Workbench

## 任务概括

交付 macro template 的持久化 schema、parser profile 引用、基础可视化 CRUD、复制、导入、导出和缓存。完成后，用户能通过浏览器面板维护可复用宏模板，而不是手写 JSON。

## 正式 task 级别及定级原因

二星任务。

本任务主要是数据模型、UI 表单和持久化，但它决定用户是否能灵活复用宏。粒度不大，风险集中在 schema 是否为后续 runner 留够空间。

## 范围内

* `.shell-deck/templates/*.json` layout。
* macro template schema 与 parserProfileId 引用校验。
* 可视化 list/create/edit/delete/copy/import/export。
* step 的表单式编辑，至少覆盖 `send_line`、`wait`、`sleep`、`input_line`、`capture-source`、`parse`、`branch`、`goto`、`loopGuard`、`pause`、`complete`、`fail`、`stop` 的配置字段。
* terminal ref 快捷引用，支持动态 index、稳定 id 和 alias。
* JSON preview 与 validation error 展示。

## 范围外

* 不执行 macro。
* 不调用 Spark。
* 不绑定 Codex session。
* 不做复杂拖拽编排。
