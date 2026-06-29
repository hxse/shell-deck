# Contract

## 任务边界

本任务交付 `shell-deck` 的 terminal deck foundation。完成后，用户应该能启动 local server，在浏览器里看到一个 config 下的多个 terminal，并让多个浏览器 tab 同步同一 config 的 terminal 输出和状态。

范围内：

* 项目骨架、开发命令和测试命令。
* server 管理 config scope、deck 和 terminal slot。
* browser client 渲染 terminal，并通过协议发送 input/resize/control。
* fake backend 用于单元和 e2e 稳定测试。
* real PTY backend 用于真实 shell。

范围外：

* macro panel 只允许占位，不实现模板 CRUD。
* 不接入 parser。
* 不识别 Codex，也不对 terminal 里的程序做语义判断。

## 任务规范

### 技术栈

V0 默认使用 `Bun + Vite + Svelte 5 + TypeScript + xterm.js + Playwright`。如果实现中需要调整，必须在本任务 execution/review 中说明原因，且不能降低 browser terminal 和测试能力。

### Config scope

`configId` 必须遵守 root `Identifier Contract`，并且必须先校验再进入 URL、WebSocket scope 或本地路径。

一个 server 可以承载多个 `ConfigScope`。同一 config 下的 browser tab 互相同步；不同 config 的 terminal、index map、macro state 和 agent output event 必须隔离。

V0 至少要有 `configId`，例如 `local`。所有 terminal list snapshot、terminal input、resize、replay、lifecycle event 都必须带上或隐含当前 `configId`，server 不能跨 config 解析 terminal index。

### Terminal identity

每个 terminal 至少有：

* `terminalId`：稳定、唯一、不可变，使用 `short-uuid` 生成并加 `term_` 前缀，例如 `term_7k3p9d`。V0 项目脚手架引入 `short-uuid` 依赖后直接使用，不自写随机 ID 逻辑。
* `terminalIndex`：当前 config 内的动态显示序号，例如 `1`、`2`、`3`。
* `visualOrder`：前端排序所需信息，可以和 index 一致，也可以由 UI 另行维护。
* `terminalAlias`：config 内唯一、用户可读、可重命名的 public id，例如 `reviewer`、`worker_1`。alias 跟着 `terminalId` 走，重排 terminal tab 不改变 alias。

`terminalId` 是真实身份，跟着 terminal 走。`terminalIndex` 是用户快捷选择器，可以随拖动 terminal tab 重新映射到不同 `terminalId`。`terminalAlias` 是用户命名的稳定别名，跟着 `terminalId` 走。server 必须维护当前 config 下的 index/id/alias 映射，并向所有 tab 同步。

后端至少维护：

* config id
* terminal id
* terminal index
* PTY process identity
* lifecycle state
* output replay buffer
* connected clients
* current cols / rows

### 协议

协议需要覆盖：

* client connected / disconnected
* config/deck snapshot
* terminal list snapshot with `terminalId` and `terminalIndex`
* terminal index/id/alias map update
* terminal output event
* terminal input request by index、id 或 alias
* terminal resize request by index、id 或 alias（协议保留；V0 UI 不暴露固定比例按钮）
* terminal lifecycle event
* replay request / response（协议保留；V0 UI 默认不暴露 Replay 调试按钮）
* terminal alias rename

前端 xterm 只显示后端 `pty_output`，不做默认 local echo。

### Real PTY input latency baseline

真实 PTY helper 默认控制通道必须是 stdin pipe。helper 通过 `select` 同时监听 PTY master fd 和 stdin 控制命令，让普通按键输入到达后立即唤醒。

禁止把 command-file append + 100ms polling 作为主输入路径。可以保留兼容路径，但正常输入、paste 和宏发送都要走低延迟控制通道。

大段 input 必须 chunk，避免 helper command buffer 截断。

### 安全边界

默认只监听 `127.0.0.1`。任何 LAN 开关都必须显式配置，并在 UI 或日志中清楚显示当前绑定地址。本任务不负责完整访问控制。

## 示例

```text
1. 启动 dev server。
2. 浏览器 A 打开 config local，看到 terminal tab 1 `terminal_1`(term_a1b2) 和 terminal tab 2 `terminal_2`(term_c3d4)。
3. terminal 1 输入 echo hello，浏览器 A 和 B 都看到同一 PTY 输出。
4. 用户拖动 terminal 2 tab 到第一位，server 同步新的 index/id/alias map。
5. hook 或 runner 里已有的 term_c3d4 或 alias `terminal_2` 仍指向同一个 live terminal。
6. 粘贴一段较长文本，PTY 收到完整内容，不出现明显 100ms polling 延迟。
```

## 测试

本任务验证 terminal deck 是真实可用的 PTY 底座。自动化负责稳定性，人工 smoke 负责交互手感。

自动化测试至少覆盖：

* unit：fake backend lifecycle、terminal manager fan-out、replay buffer、resize state。
* unit：config isolation，不同 config 下相同 terminalIndex 不互相解析。
* unit：terminalId generated through `short-uuid` with `term_` prefix。
* unit：terminalIndex / terminalId / terminalAlias map update，terminal tab reorder 后 mapping 正确。
* unit：terminalAlias rename 后跟着 terminalId 走，并可作为 terminal ref。
* unit：real PTY input chunking 与 helper control message parsing。
* integration：real shell smoke，执行 `printf` / `echo` / Ctrl-C / exit。
* e2e：两个 browser tab 同步同一 config 的 terminal output，late replay 可用。
* e2e：拖动 terminal tab 重排后，terminalId 不变，index/id/alias map 同步。
* e2e：双击 terminal tab 可重命名 alias，并同步到其他 browser tab。
* latency：普通按键和 long paste 不走 command-file polling 主链，保留 helper stdin pipe 输入路径。

人工 smoke 至少覆盖：

* 打开浏览器，新建 2-3 个 terminal tab，手动输入、长 paste、Ctrl-C、exit。
* 打开两个 browser tab，确认输出同步和 late replay 符合直觉。
* 拖动 terminal tab 改变位置，观察 `terminalIndex` 变化、`terminalId` 不变、alias/id 映射展示是否清楚。
* 双击 terminal tab 重命名 alias，确认 alias 跟着 terminalId 走且多 browser tab 同步。
* 手感检查：普通按键不出现明显 100ms polling 延迟。

Gate 规则：

* `just check`、`just build`、`just test-unit`、`just test-e2e`、`just test-002` 必须通过。
* 人工 smoke 结果必须写入 review/verification；未记录不能 Close Gate。
* 人工发现 P2 UX/语义问题时先修再进入 `.003`；P3 可记录为 known limitation。
