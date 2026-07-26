# shell-deck Quickstart

## 启动

在仓库根目录运行：

```bash
just sgl
```

production entry会先执行Vite build，再由Bun server提供静态资源、HTTP API与WebSocket。八个短命令是Just原生recipe alias，不经过shell参数解析：

```bash
just sgl  # start + guest + local
just sgn  # start + guest + LAN/network
just sal  # start + authenticated + local
just san  # start + authenticated + LAN/network
```

缩写中`s/d`表示production start/development，`g/a`表示guest/authenticated，`l/n`表示local/LAN network。运行`just start`、`just dev`或对应的`--help`形式会打印完整映射且不会先build；额外server option直接追加，例如`just san --port 5177`。可发现的长recipe（例如`just start-auth-lan`）与短alias由Just自身解析，不存在应用层mode alias或自定义参数分派。

`local`只允许本机访问；`lan`监听`0.0.0.0`，同一Wi-Fi中的手机使用电脑LAN IP，例如`http://192.168.1.23:5177`。Server不检测手机IP，只读取电脑自身网卡地址与machine hostname建立Host allowlist；API与WebSocket沿用页面hostname。防火墙仍需允许该端口。`guest lan`让能访问端口的设备拥有完整shell能力，因此启动时会打印醒目警告。

NixOS可用显式helper临时开放默认TCP端口：

```bash
just fw-open        # sudo nixos-firewall-tool open tcp 5177
just fw-open 5197   # 自定义端口
just fw-show
just fw-reset       # 确认后恢复声明式配置
```

LAN启动不会自动调用`sudo`或改写host firewall，因此这些helper不作为`sgn/san/dgn/dan`的dependency。`fw-reset`调用NixOS原生reset，会清除当前机器的全部临时firewall修改，而不只shell-deck端口；Just会先要求确认。它不写Nix配置，重启、防火墙reload或`nixos-rebuild switch`也会丢弃临时规则。非NixOS没有兼容fallback，会按缺少`nixos-firewall-tool`明确失败。

`authenticated`每次server启动生成并打印一个新token。未登录browser会进入token表单；成功后以HttpOnly cookie保存当前process的session。同一browser profile与hostname下刷新、重开或多tab无需重复输入，手机、另一browser/hostname或server restart需要重新输入。Token不会进入应用URL或cookie。

开发时使用相同mode：

```bash
just dgl  # dev + guest + local
just dan  # dev + authenticated + LAN/network
```

development recipe使用Vite HMR，Bun继续承载API/WebSocket。Authenticated dev下，Room page与Vite source/asset都先经过同一个Bun session gate；登录后正常加载，未登录不会暴露source。Vite与Bun共享LAN hostname allowlist并关闭clear-screen，因此machine hostname可访问，启动终端中只打印一次的token也会保持可见。旧`--host`与`SHELL_DECK_ALLOW_LAN`已删除；底层server缺少access/listen mode会直接失败，旧环境变量即使为空也会直接报错。

## Room URL

第一次访问 `http://127.0.0.1:5177/` 且当前没有 live Room 时，server 会创建随机 Room 并跳转到：

```text
http://127.0.0.1:5177/room_<22-char-short-uuid-v4>
```

再次打开根 URL 会进入 Room Home。Home 可查看当前 process 的 Room 清单，并执行 New、Open、Destroy；最多同时存在 32 个 Room。关闭 browser tab 不会销毁 Room。Room 页面上的 Home 按钮在新标签页打开根 URL，不影响当前 Room。

Home没有手动Refresh；页面可见时每秒自动读取server Room清单，切到后台时停止，重新获得focus/visibility时立即刷新。

把同一个完整 Room URL 放到另一个标签页或设备，会连接同一 live Room并同步 terminal order、Text content、PTY output 与 replay。Room 和 terminal 都只在当前 server process 内存在；server restart 后，即使重新访问相同 token，也会得到新的 generation 和空 runtime。

第一个连接是controller，顶栏显示`Control: This device`；之后打开的同Room页面显示`Read-only · Take control`。observer仍能查看、滚动、复制、切换terminal和修改本地Settings，但不能输入Shell、编辑Text或改变terminal结构。点击Take control并确认后，当前页面取得写权，原页面立即只读。断线、release或TTL后不会自动把写权交给另一个页面，需显式点击Take control。

Take Control不会丢失共享terminal或active Macro run；另一设备browser-local的未保存Macro draft仍留在该设备，只是取得control前不能保存shared change。observer点击明确写操作时会看到可复制的短暂toast，而不是无提示失效。

## Terminal

Room 内可创建：

* `New shell`：不弹路径输入框。server继承当前最高index Shell的实时cwd；没有Shell或无法读取时使用`$HOME`。
* `New text`：创建同步纯文本 terminal；Text 没有 cwd。

Terminal tab与正文header显示同一条单行label：连续index、runtime terminalId、Shell实时cwd、kind、status；Text省略cwd。没有alias/rename。开启Settings中的drag toggle后可拖拽；index随UI顺序变化，terminalId、launch和kind跟随terminal object，cwd随Shell执行`cd`实时更新。

Text输入在当前browser立即更新；后台以100ms leading/trailing节流把连续replacement或必要的full replace同步到server，并用textRevision与完整正文SHA-256校验每次合并。revision/hash不一致会自动请求一次authoritative full snapshot；重复不一致会明确报错而不是循环覆盖。切tab、关闭/拖拽当前Text tab或Start前会flush pending正文，browser仍有pending write时离开页面会出现native确认。超长Text和Macro textarea只渲染viewport附近的行号。

## Theme

在任一Room打开`Settings → Theme`即可选择`system`或35个daisyUI内置theme。新browser默认选择`business`；已有合法current setting会逐值保留。Theme属于当前browser的本地presentation setting：observer也可修改，刷新后保留，并同时覆盖Home、Room、terminal、Macro与notice；它不会写入Room、server或saved record，也不会跨设备同步。`system`仍实时跟随OS light/dark，选择explicit theme后不再随OS变化。button、input、select、textarea、tab与状态提示直接使用daisyUI当前theme的原生surface、background、focus与disabled样式；普通command使用当前theme的solid semantic button，只有移动、折叠、复制、取消等低权重chrome action使用ghost。input、select与普通textarea使用当前theme的content color生成无边框半透明填充面，因此在深色Theme中变亮、浅色Theme中变暗，不依赖某一个Theme的特殊CSS。明显的线条只用于pane、header、popover、editor gutter等真实结构边界。

## Codex hook

`just codex` 只支持从 shell-deck 创建的 Shell 内运行，因为该 Shell 已注入完整 Room/terminal/launch ingest context。普通外部 terminal 调用会在启动 Codex 前返回：

```text
shell_deck_room_context_required
```

不存在 global ingest、manual identity、disk spool/import 或 unbound evidence fallback。

### Structured JSON result

需要Codex或其他terminal程序返回稳定字段时，不要解析普通assistant文字。Macro先用Send明确要求程序完成任务并在结果准备后执行：

```bash
printf '%s' '{"decision":"retry","confidence":0.82}' \
  | just -f "$SHELL_DECK_JUSTFILE" submit-json
```

随后添加root `Capture → structured-json`，选择同一个Shell、填写JSON Schema并设置可选timeout。Schema字段与普通多行文本使用相同的自适应高度；Schema合法后可点击`View suggested prompt`查看包含当前Schema和提交命令的完整参考提示词，再把它复制到需要的Send。参考提示词由上下相同的`------------`包裹，分隔线与正文之间以及整个区块前后都用换行隔离。modal中的`Copy`只是快捷方式；clipboard权限被拒绝时正文仍可选中，并会提示手动`Ctrl/Cmd+A`、`Ctrl/Cmd+C`。它不会猜测或自动改写某个Send。

`SHELL_DECK_JUSTFILE`由shell-deck Shell注入为当前checkout的canonical absolute justfile路径，因此terminal cwd或项目checkout位置变化不会让参考命令失效。命令没有Room或step参数；它从当前shell-deck Shell继承Room generation、terminalId、launchId、URL与memory-only token，因此普通外部terminal缺少完整context，其他Room或旧launch也不能误投。

server只接受当前run在该terminal等待的第一份schema-valid JSON。schema不匹配时命令打印`structured_json_schema_mismatch`及issues，Capture继续等待，可修正后重新提交；Pause期间可接收但Resume后才推进，Stop会取消等待。Capture输出typed `captured_json`。后续If可选择`json_match`，用JSON Pointer（例如`/decision`）和typed equals/number matcher分支；也可把它选作root/Parallel Send、Notify message、Input default、Extract Text或`text_match`的source。后一类textual consumer统一读取成key稳定排序的compact单行JSON且不附加换行，所以Send仍只由自己的Ending sequence决定是否提交；artifact本身不会双写成text。structured Capture本身仍不能放进Parallel lane，Parallel final Output也只收集lane-local text。

## 长期数据

User Data Root 的解析顺序为：显式 root、`SHELL_DECK_DATA_ROOT`、`XDG_DATA_HOME/shell-deck`、`$HOME/.local/share/shell-deck`。MacroRecord、run/artifact evidence、AgentEvent evidence和notification config都在这里；它们不属于 Room 或 terminal cwd。current runtime只管理`macros/`、`runs/`、`agent-events/`与`.locks/`。

`runs/`中的Trace/events/artifacts与`agent-events/`raw logs默认共享2 GiB配额。可在启动前设置positive integer bytes，例如`SHELL_DECK_LOG_STORAGE_LIMIT_BYTES=4294967296 just sgl`改为4 GiB；变量若存在但为空或不是positive integer会直接报错，MacroRecord与notification config不计入。达到上限后server清理到约90%：先删除最旧的completed/failed/stopped run整个目录，再删除已经关闭的旧AgentEvent segment。当前Room仍显示的最近一次run、active/interrupted run和仍可追加的open segment不会删除；下一次Start替换或Room Destroy后，旧current run才进入普通历史回收。没有安全候选时会明确报告`log_storage_limit_reached`。AgentEvent current layout是8 MiB编号segment，每条event写入前都检查配额；旧的单个`<generation>.jsonl`日志不迁移、不读取。

notification 配置可用以下命令初始化：

```bash
just notification-config-init
```

`.032`交付Room/user-storage foundation，`.033`交付Room controller与跨Room/process的saved-content edit lease，`.034`交付production Macro editor/runner，`.035`交付server-authoritative runtime sync，`.037`切换到`MacroDefinitionV4` exact assigned/unassigned reference，`.038`再切换到`MacroDefinitionV5` explicit AgentEvent wait limit，`.039`让访问过的terminal view在tab切换时保持挂载，不再重复回放长历史。`20260724A`删除原`.036` Library domain，MacroRecord成为唯一saved user content；`20260724B`加入structured JSON Capture，`20260724C`稳定Macro逐字符编辑，`20260724D`把Text/Runner/Trace等热路径切换为增量projection和分页读取。

## Macro

新Room默认不选择Macro。点击Macro面板的New创建client-local draft；Save只校验并保存portable、persistable的`MacroDefinitionV5`，不要求当前Room已有匹配terminal。definition只保存连续terminal index/type，不保存terminalId、cwd或Room identity。terminal target与必填artifact source使用exact tagged reference；新slot默认`{kind:"unassigned"}`，可Save但不可Start，旧primitive `terminalIndex`与空`stepId`写法会直接失败。

Macro结构操作栏中，`↑`/`↓`移动当前项，`+↑`在当前项之前插入，`+↓`在当前项之后插入；Flow node、Parallel lane action与For text-list item使用同一套含义。插入按钮仍打开对应位置的action/flow palette，移动按钮不会创建新项。

AgentEvent与structured JSON Capture提供`Enable timeout`。默认关闭并保存`waitLimit:{kind:"unbounded"}`，一直等待结果或用户Stop；开启后保存显式duration，Pause期间不计算超时时间。server不存在隐藏的10分钟Capture超时。

需要调整当前Room terminal顺序/类型时，显式点击Start左侧的`Prepare terminals`。它读取当前visual draft或JSON Edit buffer的terminal layout；切换Macro、Save、Start和terminal变化都不会自动Prepare。Prepare只keep/move/create/insert，不删除或修复failed/exited terminal。

Start要求Macro已经Save，先通过runnable completeness（所有terminal/artifact reference均assigned），再要求当前terminal layout/type/readiness匹配。启动时server把index解析成terminalId/launchId并冻结，运行中terminal结构保持锁定；Pause只暂停live run，server restart或Room Destroy后不能Resume。Trace、manifest、events和artifact仍可只读查看，但不会恢复runner。Trace先分页列出当前Room的run summaries；选中一个run后再分页读取其retained events，不会一次下载全部历史。

Macro selector、visual/JSON draft和未保存编辑只属于当前browser。Save/Delete后的record会同步，但不会切换其他browser的selector。saved Macro退出Edit后由`Read-only`提示明确标记，正文、field与flow node仍保持正常可读对比度；直接点击这条normal read-only提示，或聚焦后按Enter/Space，会先获取该record的content edit lease，成功后进入Edit。只有这条提示是快捷入口，点击正文/field不会进入Edit；active run、controller loss、pending或lease-lost提示也不会误触Edit。不同嵌套depth的纵向guide和横向渐隐separator都直接跟随当前Theme的semantic color。Start后Room另有只读Running Macro；status、current step、Pause/Resume/Stop以及Input Action的prompt/draft/submit都由server主动同步到同Room设备。关闭所有页面不会停止run，重新进入原Room URL会立即得到当前live snapshot。

产品不再提供内建Library、Prompt/Note素材库、Import或Export。需要外部保存时，使用Copy把current `MacroDefinitionV5` JSON写入clipboard后存到Gist等外部工具；恢复时显式New、进入JSON Edit、Paste并Save。shell-deck只接受当时的current schema，旧版本、alias和缺失字段都会fail loudly，不做自动升级。

Notify Action在server只执行一次并向当时在线的同Room browser各广播一条message；Telegram与System notification都只呈现一次。每个browser去重后，App channel按`repeatCount`与`repeatIntervalMs`重复toast/sound；reconnect、Room切换或workspace dispose会取消尚未触发的剩余重复。后进入的browser不补弹历史通知，但仍可在Trace查看event。

## 验证

```bash
just check
just build
just test-032
just test-033
just test-034
just test-035
just test-037
just test-038
just test-039
just test-20260724a
just test-20260724b
just test-20260724c
just test-20260724d
just test-20260725a
just test-20260725b
just test-20260725c
```
