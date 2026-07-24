# 20260724B Structured JSON Submission Capture

## 任务概括

为Macro增加terminal-scoped的structured JSON提交链路：terminal内程序通过无参数`just submit-json`提交JSON，当前`structured-json` Capture按Room/terminal/launch隔离、用JSON Schema校验并产出typed `captured_json`；后续既可由`If json_match`按JSON Pointer和typed matcher分支，也可由统一textual projection再次Send、通知、预填Input、Extract或text match。

## 任务级别

三星任务。它同时修改MacroDefinitionV5、shared validator、runner live wait、HTTP ingest、terminal环境、justfile CLI、artifact类型、visual editor、Trace evidence和用户指南；错误关联会造成quietly wrong分支。

## 范围

范围内：无step ID的structured submission、Room runtime identity与固定验证顺序、JSON Schema-aware local reference校验、root Flow Capture、typed JSON artifact、JSON condition、canonical compact textual projection、canonical justfile env、Schema-derived建议提示词及其clipboard/manual-copy路径、CLI/UI/测试/active spec同步。

范围外：Codex专属编排、global command安装、外部terminal提交、Parallel lane structured Capture、跨server持久等待、submission queue、step token、旧schema兼容或自动迁移、远端JSON Schema加载。
