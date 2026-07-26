# 20260726A Meta

## 任务概括

为shell-deck增加显式`guest|authenticated`访问模式和`local|lan`监听模式，并以八个Just原生recipe alias提供简短、无歧义的启动入口。Authenticated使用每次server启动生成的临时token换取browser cookie session；Guest保留完整功能，但所有模式都执行browser同源保护。

## 任务级别

三星任务。它改变server启动contract，并在全部HTML、HTTP API和WebSocket之前增加安全admission；错误实现可能让恶意网页控制真实PTY，或阻断手机通过LAN访问。

## 范围

范围内：just/CLI/StartOptions current-schema cutover、四种模式、临时token与memory-only session、login page、HTTP/WS同源保护、LAN warning、Vite dev双端口衔接、Hook ingest-token保留、focused与完整Gate、active spec和用户指南。

范围外：账号、用户、角色、权限等级、永久token、token配置文件、HTTPS/TLS、反向代理自动发现、公网暴露、设备管理、session UI、logout、rate limit与通用resource envelope。
