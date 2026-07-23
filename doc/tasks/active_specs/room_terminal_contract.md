# Room Terminal Contract

## Identity

所有 system-generated opaque ID 使用 `short-uuid@6.0.3` 的完整 22 字符 Flickr Base58 UUID-v4 suffix，并经 `src/lib/generatedId.ts` 统一生成和 strict round-trip validation。Room、generation、client、terminal 与 launch 分别使用 typed prefix。

Terminal 没有 alias 或 rename identity。`terminalId`、kind、cwd 与 terminal object 一起存活；`launchId` 在 reset 时更新。连续一基 index 精确反映当前 UI 顺序，拖拽/插入/删除后实时重算，而 terminalId 不变。Room protocol 只接受 terminalId 或当前 index；旧 `terminalAlias`、`rename_terminal` 和 alias selector fail loudly。

server还维护authoritative `terminalStructureRevision`。它只在create/delete/order/type/terminalId/launchId binding变化时递增；starting/ready/exited/failed等readiness变化继续广播并重新运行UI validation，但不递增structure revision。runtime position统一导出index、type、terminalId、launchId和readiness，Macro不得自行从browser tab顺序推导第二份binding truth。

## Backends 与 cwd

* `real`：本机 PTY Shell。create可传存在且可访问的absolute cwd；省略时精确使用`$HOME`。其runtime cwd初值为launch cwd，随后由server读取实际Shell process cwd并同步。Room UI的New shell不弹路径框、不发送cached path，只请求server继承当前最高index Shell的live cwd并跳过Text；没有Shell或probe不可用时使用`~`/`$HOME`。
* production `real` Shell不改写`HISTFILE`，依照server进程的用户环境读写全局Shell history，因此可与Konsole等本机终端共享。所有官方自动化test harness必须在启动任何real PTY前强制`HISTFILE=/dev/null`：当前测试Shell的in-memory history仍可使用，但不读取、不写入用户`~/.bash_history`。这是test-only process env，production backend不包含test mode、path猜测或自动history cleanup。
* `fake`：确定性测试 Shell backend，遵循同一 cwd/identity contract。
* `text`：同步纯文本 terminal，没有 cwd，完整保留用户正文。

cwd属于单个Shell terminal，不属于Room、Macro或server。执行`cd`会改变live cwd；拖拽不改变process，但会改变哪个Shell是最高index。cwd变化只发送轻量runtime event，不重发replay、不持久化，server不在terminal cwd写`.shell-deck`数据。它递增live room/terminal revision，但不属于Macro使用的terminal structure revision。

terminal backend lifecycle由内部`terminalBackendCoordinator`单点协调：candidate `start()`期间的同步data/exit/error先缓冲，Room ticket与candidate成功后才commit并按snapshot/index/output原顺序发布；reset与destroy的旧backend close promise继续登记到同一Room drain。current callback必须同时匹配Room generation、Terminal object与launch identity，cwd debounce随terminal close/reset/destroy取消。外部仍只通过`TerminalRoomManager`facade访问，coordinator不拥有第二份terminal registry。

上述继承只适用于用户点击New shell；Macro Prepare创建Shell时始终显式使用`$HOME`，避免把某个live terminal的路径写成Macro含义。

terminal tab与pane header使用同一个canonical单行label：`index · terminalId · [current cwd ·] kind · status`。Text省略cwd；两处内容一致并ellipsis，完整值放入title，pane header可选择复制。

## Replay 与客户端

server 维护每个 Shell 的 2 MiB byte-bounded replay tail，Text 不截断。PTY output 在 server batching 后广播；每个 WebSocket 有独立 64 MiB backpressure queue。browser 再按 animation frame 合并连续 output，并以 generation-aware write pump 驱动 xterm，避免大历史一次性加载时逐 chunk 重渲染。完整 replay/replace 写入 xterm 时属于历史 hydration，必须在 parser callback 确认全部消费前关闭 stdin，使历史中的DA、cursor、OSC color等terminal query不能产生新的PTY input；hydration完成后的live append恢复正常query response。不得通过删除escape sequence或全局丢弃xterm response实现该边界。

terminal view采用lazy retained lifecycle。未访问terminal不mount、不解析replay；第一次成为active时hydration一次。已经访问且仍属于Room的Shell/Text pane在tab切换后只hidden，不unmount，不重建xterm/Text editor，也不重新enqueue完整replay。hidden Shell继续消费live append，但不测量零尺寸或上报PTY resize；再次active后只做必要的host fit。terminal删除、Room workspace退出、launch/reset触发的authoritative replace仍按对应生命周期销毁或重建。active selection仍是browser-local纯UI状态，切tab不得产生Room mutation。

Shell xterm采用native follow-output语义：新建及authoritative replace hydration完成后定位到底部；用户位于底部时live append继续follow，用户通过wheel或scrollbar离开底部后，live append不得强制改变其历史viewport，主动回到底部后自然恢复follow。host/grid resize必须先判断resize前是否位于底部，只有原本位于底部时才显式恢复bottom；不得因fit、panel resize、tab activation或controller/observer变化打断历史回顾。viewport只属于当前browser中的xterm instance，不新增Room消息、偏好设置或持久化状态。

xterm继续加载package-owned vendor CSS，project只在唯一`src/app.css`中保留generated subtree的最小position/size/overflow bridge。browser Theme以effective light/dark选择两套完整ANSI palette，并原位赋给既有`xterm.options.theme`；explicit Theme或`system` media变化不得重建instance、清buffer、改变viewport/selection/cursor或中断后续PTY output。terminal chrome颜色来自daisyUI semantic token，不写入Room/terminal protocol。

Room与每个terminal分别维护单调roomRevision/terminalRevision；Text另有textRevision，每次PTY output或Text正文变化另推进outputActivityRevision。quiet判断使用activity revision，不能比较已截断replay的长度。terminal structure lock acquire/release都推进roomRevision。browser对完整Room snapshot与index map分别维护channel watermark：同一channel只有首次或revision严格更新时才能覆盖Room级字段；两种companion message可各自消费同一revision，terminal-specific event不冒充Room projection watermark。equal/older delayed snapshot不得重写structure lock。terminal-specific event按launchId + terminalRevision合并，只有accepted terminal snapshot才能派生readiness/position，跨HTTP/WebSocket的延迟snapshot不得回滚新真值。

Text browser每个terminal串行一个full-state write，后续输入coalesce为latest value并带local edit generation。只有前进的textRevision和匹配正文才能确认在途echo；确认时若generation已变化，即使最终文字与旧值相同也要重发latest。旧own-echo不能覆盖较新输入，observer只消费server revision。

真实PTY runtime root及其bin/etc必须是当前uid拥有的0700 non-symlink directory；helper/bashrc必须是当前uid拥有的0700/0600 regular file。helper不按mtime信任既有文件，而在每个process首次使用时通过verified temporary、fsync和atomic rename安装。just stop使用包含pid、serverInstanceId和Linux process start time的strict JSON PID record，并在start time与精确server argv均匹配后才发送signal；任何identity读取失败都fail closed。

selected terminal严格属于browser-local state。Room snapshot、terminal snapshot与其他client创建terminal的广播只能更新terminal集合，不能改写已有且仍有效的active terminal。发起New Shell/Text的client在create成功后单独收到不含client identity的`terminal_created`消息，并只在该client选择新terminal；observer不收到该消息。当前没有有效selection时，client本地选择排序后的第一个terminal。

最后一个 client 断开不会销毁 Room。晚到 client 收到当前 snapshot/replay；Destroy 或 server shutdown 才关闭目标 Room 的 terminal/process。

Home不提供手动Refresh。Home可见时Svelte 5 effect每秒读取同一server Room registry；页面hidden或离开Home时cleanup，focus/visibility恢复时立即读取。读取不会建立browser-to-browser通道。

## Macro binding 与 structure lock

MacroDefinition只保存连续index/type。显式Prepare与Start均携带调用者看到的`expectedTerminalStructureRevision`，并通过同一Room lifecycle ticket、controller guard与structure queue串行执行；revision不匹配必须在任何mutation前返回conflict。Prepare只调结构，Start还要求所有binding ready。

Start把index/type解析为terminalId/launchId后冻结routing。active run期间create/delete/reorder/reset/Prepare等terminal structure mutation由UI和server共同拒绝；Pause不解锁，Stop或run终态后才释放。Home Destroy不是普通structure mutation，它先关闭Room admission并abort/drain在途操作，再清理runtime。

## Single-controller

同一Room任一时刻只有一个controller。fresh generation中第一个完成WebSocket握手的client自动取得控制；其余连接是observer。observer继续接收snapshot/output/replay，可以选择terminal、滚动、复制和修改包括Theme在内的browser-local Settings，但Shell input、Text edit、terminal create/close/reset/reorder/resize等shared mutation同时由UI readonly和server统一guard拒绝。Theme change不要求controller，也不发送Room mutation。

顶栏显示`Control: This device`、`Read-only · Take control`或`Reconnecting · Read-only`。Take Control使用确认时看到的controlEpoch，成功后旧owner立即收到`room_control_lost`；release、disconnect或30秒TTL到期只进入available，不自动提升普通observer。若同一browser tab在reload或短暂重连前就是controller，它可在5秒窗口内保存非secret session intent，并仅在server已广播available时自动执行正常epoch-bound acquire；它不保存grant、不自动takeover，也不能抢走另一个live controller。owner server每10秒用WebSocket ping/pong续期，browser timer不承担authority。

Take Control只转移writer，不清空terminal、Text或active Macro run，也不搬运/删除另一设备browser-local的未保存Macro/Library draft。所有明确shared mutation的client guard和server rejection进入同一toast：默认3秒、hover暂停、mouseleave继续、文字可复制、点击外部立即关闭；不能再用silent disabled制造“点击没反应”。

HTTP shared mutation使用仅owner可见的clientId/controlLeaseId/controlEpoch bearer，并逐请求复核live owner WebSocket、Room generation和lifecycle。grant只在内存中存在，不进入observer message、Room list、Trace、URL或localStorage。Home New/Destroy是generation-bound process lifecycle operation，不要求目标Room controller；Destroy仍先关闭admission并撤销control/content lease，再清理runtime。

control实现保持单向组合：内部`roomControlCoordinator`是`TerminalRoomManager`消费的唯一facade；`roomClientPresenceCoordinator`只负责client registration、disconnect、ping/pong与heartbeat sweep，`roomControllerLeaseCoordinator`唯一转换`room.controller/controlEpoch`并负责personalized view、takeover/release与controlled ticket。二者直接操作manager创建的同一组Room/client map reference，不建立cache、shadow registry或第二份owner state；其他production consumer不得直接拼装internal coordinator。takeover在old-owner cleanup await后仍复核Room lifecycle与new owner context，published-operation仍只在publish前鉴权，不能因模块拆分新增post-commit false failure。
