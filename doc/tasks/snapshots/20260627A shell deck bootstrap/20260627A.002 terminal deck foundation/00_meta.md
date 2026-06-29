# 20260627A.002 Terminal Deck Foundation

## 任务概括

初始化 `shell-deck` 可运行项目，交付 local server、browser terminal deck、多 terminal slot、多浏览器 tab 同步、真实 PTY 和输入延迟稳定化基线。

## 正式 task 级别及定级原因

三星任务。

这是 V0 的执行底座。若 terminal 输入、输出、replay、resize 或多 tab 同步不稳定，后续 macro runner 和 parser 都没有可靠承载层。

## 范围内

* 初始化 Bun + Vite + Svelte 5 + TypeScript + xterm.js + Playwright 项目骨架。
* 实现 local server 和浏览器客户端连接协议。
* 实现 deck 与 terminal slot 模型，至少支持多个编号 terminal。
* 实现 fake terminal backend 与 real PTY backend。
* 从第一版保留 Real PTY stdin pipe 控制通道，避免 command-file polling 输入延迟。
* 实现 output fan-out、replay buffer、resize、exit、Ctrl-C、paste chunking。
* 默认绑定 `127.0.0.1`。

## 范围外

* 不实现 macro template 编辑器。
* 不实现 macro runner。
* 不实现 parser。`regex`/`ai-json` 留给 `.007`。
* 不实现 Codex launcher、Codex session binding 或 role。
* 不实现 LAN auth。
