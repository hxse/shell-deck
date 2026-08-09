# 20260809A Codex launch workspace and capture guidance

## 任务概括

修复从其他项目目录执行`just -f <shell-deck>/justfile codex`时Codex错误以shell-deck为workspace的回归；同时在Codex AgentEvent Capture编辑区显示可见、可手工选择且可一键复制的推荐启动命令。

## 正式级别

二星任务。cwd修复局部，但横跨Just recipe、Codex wrapper进程边界、Macro UI、clipboard failure feedback、用户指南与回归测试。

## 范围

范围内：保留Just调用目录作为Codex默认workspace；继续透传原生Codex参数；root与Parallel的Codex AgentEvent Capture启动提示/复制；focused regression；active spec、Quickstart与index同步。

范围外：修改`~/nixos-config`中的Codex/Serena wrapper；自动启动Codex；修改hook、AgentEvent protocol、Capture runtime或Macro schema；向browser暴露server filesystem path；增加clipboard权限流程。
