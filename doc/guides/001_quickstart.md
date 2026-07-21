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

Home没有手动Refresh；页面可见时每秒自动读取server Room清单，切到后台时停止，重新获得focus/visibility时立即刷新。

把同一个完整 Room URL 放到另一个标签页或设备，会连接同一 live Room并同步 terminal order、Text content、PTY output 与 replay。Room 和 terminal 都只在当前 server process 内存在；server restart 后，即使重新访问相同 token，也会得到新的 generation 和空 runtime。

第一个连接是controller，顶栏显示`Control: This device`；之后打开的同Room页面显示`Read-only · Take control`。observer仍能查看、滚动、复制、切换terminal和修改本地Settings，但不能输入Shell、编辑Text或改变terminal结构。点击Take control并确认后，当前页面取得写权，原页面立即只读。断线、release或TTL后不会自动把写权交给另一个页面，需显式点击Take control。

Take Control不会丢失共享terminal或active Macro run；另一设备browser-local的未保存Macro/Library draft仍留在该设备，只是取得control前不能保存shared change。observer点击明确写操作时会看到可复制的短暂toast，而不是无提示失效。

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

User Data Root 的解析顺序为：显式 root、`SHELL_DECK_DATA_ROOT`、`XDG_DATA_HOME/shell-deck`、`$HOME/.local/share/shell-deck`。MacroRecord、Library、run/artifact evidence、AgentEvent evidence和notification config都在这里；它们不属于 Room 或 terminal cwd。

notification 配置可用以下命令初始化：

```bash
just notification-config-init
```

`.032`交付Room/user-storage foundation，`.033`交付Room controller与跨Room/process的saved-content edit lease，`.034`交付production Macro editor/runner，`.035`交付server-authoritative runtime sync，`.036`接入Library UI，`.037`切换到`MacroDefinitionV4` exact assigned/unassigned reference，`.038`再切换到`MacroDefinitionV5` explicit AgentEvent wait limit。

## Macro

新Room默认不选择Macro。点击Macro面板的New创建client-local draft；Save只校验并保存portable、persistable的`MacroDefinitionV5`，不要求当前Room已有匹配terminal。definition只保存连续terminal index/type，不保存terminalId、cwd或Room identity。terminal target与必填artifact source使用exact tagged reference；新slot默认`{kind:"unassigned"}`，可Save但不可Start，旧primitive `terminalIndex`与空`stepId`写法会直接失败。

AgentEvent Capture新增`Enable timeout`。默认关闭并保存`waitLimit:{kind:"unbounded"}`，一直等待Codex结果或用户Stop；开启后保存显式duration，Pause期间不计算超时时间。server不再存在隐藏的10分钟AgentEvent超时。

需要调整当前Room terminal顺序/类型时，显式点击Start左侧的`Prepare terminals`。它读取当前visual draft或JSON Edit buffer的terminal layout；切换Macro、Save、Start和terminal变化都不会自动Prepare。Prepare只keep/move/create/insert，不删除或修复failed/exited terminal。

Start要求Macro已经Save，先通过runnable completeness（所有terminal/artifact reference均assigned），再要求当前terminal layout/type/readiness匹配。启动时server把index解析成terminalId/launchId并冻结，运行中terminal结构保持锁定；Pause只暂停live run，server restart或Room Destroy后不能Resume。Trace、manifest、events和artifact仍可只读查看，但不会恢复runner。

Macro selector、visual/JSON draft和未保存编辑只属于当前browser。Save/Delete后的record会同步，但不会切换其他browser的selector。Start后Room另有只读Running Macro；status、current step、Pause/Resume/Stop以及Input Action的prompt/draft/submit都由server主动同步到同Room设备。关闭所有页面不会停止run，重新进入原Room URL会立即得到当前live snapshot。

Notify Action在server只执行一次：Telegram只发送一次；当时在线的同Room browser各自收到App/System通知，后进入的browser不补弹历史通知，但仍可在Trace查看event。

## Library

顶栏Library按钮打开独立side panel。Library是user-global长期素材，不跟随Room、terminal cwd或当前选中的Macro切换；内部固定为Macro JSON、Prompt、Note三个tab，tab与search filter保存在browser localStorage。

saved item默认只读。New建立browser-local draft；Edit取得该`(kind,itemId)`的content edit lease；Save/Delete同时验证Room controller、lease与expected revision。另一Room或server process编辑同一item时，本页面仍可Search、Read、Copy，但必须显式take over lease后才能写；不同item互不阻塞。

Copy只把当前content写入clipboard，不创建item，也没有Duplicate/Import/Export。Prompt与Note接受任意文本。Macro JSON只接受纯、persistable的`MacroDefinitionV5`，包括合法的`{kind:"unassigned"}`；Validate、Save和Load into Macro共用唯一text validator。Load每次创建fresh MacroRecord。当前Macro editor clean时创建后自动选中，存在未保存编辑时只创建、不切换；两种情况都不会Prepare terminals。

## 验证

```bash
just check
just build
just test-032
just test-033
just test-034
just test-035
just test-036
just test-037
just test-038
```
