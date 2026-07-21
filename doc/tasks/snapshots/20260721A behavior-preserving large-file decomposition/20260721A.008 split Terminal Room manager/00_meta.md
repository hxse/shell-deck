# 20260721A.008 Split Terminal Room Manager

## 任务概括

拆分`server/terminalRoomManager.ts`内部的terminal replay、runtime state、snapshot projection、Room lifecycle和terminal structure mutation。TerminalRoomManager继续作为HTTP、WebSocket、runner与PTY backend唯一公开facade，并保留每个Room唯一串行critical section。

## 正式 task 级别及定级原因

三星任务。

该manager是live Room真值，维护terminal id/type/index/launch、PTY/Text、revision、replay、controller client与destroy barrier。拆错会导致发送到错误terminal、旧snapshot回滚、mutation越过run lock或PTY泄漏。

## 范围内

* 抽取bounded replay buffer与output activity tracking。
* 抽取Shell/Text runtime state和snapshot projection。
* 抽取Room lifecycle与terminal mutation内部coordinator。
* 保留manager public API、Room registry和single serialized queue。

## 范围外

* 不改变Room URL/generation、terminal id/index/type/launch语义。
* 不改变PTY backend、Text revision、replay bytes/filter、input FIFO或current cwd行为。
* 不改变controller/runner structure lock、Destroy和Prepare mutation contract。
* 不持久化Room/terminal，也不新增terminal数量硬上限。
