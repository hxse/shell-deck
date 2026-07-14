# shell-deck Quickstart

## 启动

在仓库根目录运行：

```bash
just start
```

production entry 会先执行 Vite build，再由 Bun server 提供静态资源、HTTP API 与 WebSocket。开发时使用：

```bash
just dev
```

`just dev` 使用 Vite HMR，Bun 继续承载 API/WebSocket。默认监听 `127.0.0.1:5177`；只有明确设置 `SHELL_DECK_ALLOW_LAN=1` 才允许非本地 bind。

## Room URL

第一次访问 `http://127.0.0.1:5177/` 且当前没有 live Room 时，server 会创建随机 Room 并跳转到：

```text
http://127.0.0.1:5177/room_<22-char-short-uuid-v4>
```

再次打开根 URL 会进入 Room Home。Home 可查看当前 process 的 Room 清单，并执行 New、Open、Destroy；最多同时存在 32 个 Room。关闭 browser tab 不会销毁 Room。Room 页面上的 Home 按钮在新标签页打开根 URL，不影响当前 Room。

把同一个完整 Room URL 放到另一个标签页或设备，会连接同一 live Room并同步 terminal order、Text content、PTY output 与 replay。Room 和 terminal 都只在当前 server process 内存在；server restart 后，即使重新访问相同 token，也会得到新的 generation 和空 runtime。

第一个连接是controller，顶栏显示`Control: This device`；之后打开的同Room页面显示`Read-only · Take control`。observer仍能查看、滚动、复制、切换terminal和修改本地Settings，但不能输入Shell、编辑Text或改变terminal结构。点击Take control并确认后，当前页面取得写权，原页面立即只读。断线、release或TTL后不会自动把写权交给另一个页面，需显式点击Take control。

## Terminal

Room 内可创建：

* `New shell`：不弹路径输入框。server继承当前最高index Shell的实时cwd；没有Shell或无法读取时使用`$HOME`。
* `New text`：创建同步纯文本 terminal；Text 没有 cwd。

Terminal tab与正文header显示同一条单行label：连续index、runtime terminalId、Shell实时cwd、kind、status；Text省略cwd。没有alias/rename。开启Settings中的drag toggle后可拖拽；index随UI顺序变化，terminalId、launch和kind跟随terminal object，cwd随Shell执行`cd`实时更新。

## Codex hook

`just codex` 只支持从 shell-deck 创建的 Shell 内运行，因为该 Shell 已注入完整 Room/terminal/launch ingest context。普通外部 terminal 调用会在启动 Codex 前返回：

```text
shell_deck_room_context_required
```

不存在 global ingest、manual identity、disk spool/import 或 unbound evidence fallback。

## 长期数据

User Data Root 的解析顺序为：显式 root、`SHELL_DECK_DATA_ROOT`、`XDG_DATA_HOME/shell-deck`、`$HOME/.local/share/shell-deck`。MacroRecord foundation、run/artifact evidence、AgentEvent evidence、notification config 和后继 Library 都在这里；它们不属于 Room 或 terminal cwd。

notification 配置可用以下命令初始化：

```bash
just notification-config-init
```

`.032`交付Room/user-storage foundation，`.033`交付Room controller与跨Room/process的saved-content edit lease，`.034`交付production Macro V3 editor/runner；Library UI由`.035`接入。

## Macro

新Room默认不选择Macro。点击Macro面板的New创建client-local draft；Save只校验并保存portable `MacroDefinitionV3`，不要求当前Room已有匹配terminal。definition只保存连续terminal index/type，不保存terminalId、cwd或Room identity。

需要调整当前Room terminal顺序/类型时，显式点击Start左侧的`Prepare terminals`。它读取当前visual draft或JSON Edit buffer的terminal layout；切换Macro、Save、Start和terminal变化都不会自动Prepare。Prepare只keep/move/create/insert，不删除或修复failed/exited terminal。

Start要求Macro已经Save，并要求当前terminal layout/type/readiness匹配。启动时server把index解析成terminalId/launchId并冻结，运行中terminal结构保持锁定；Pause只暂停live run，server restart或Room Destroy后不能Resume。Trace、manifest、events和artifact仍可只读查看，但不会恢复runner。

## 验证

```bash
just check
just build
just test-032
just test-033
just test-034
```
