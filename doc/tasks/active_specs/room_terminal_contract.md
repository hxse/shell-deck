# Room Terminal Contract

## Identity

所有 system-generated opaque ID 使用 `short-uuid@6.0.3` 的完整 22 字符 Flickr Base58 UUID-v4 suffix，并经 `src/lib/generatedId.ts` 统一生成和 strict round-trip validation。Room、generation、client、terminal 与 launch 分别使用 typed prefix。

Terminal 没有 alias 或 rename identity。`terminalId`、kind、cwd 与 terminal object 一起存活；`launchId` 在 reset 时更新。连续一基 index 精确反映当前 UI 顺序，拖拽/插入/删除后实时重算，而 terminalId 不变。Room protocol 只接受 terminalId 或当前 index；旧 `terminalAlias`、`rename_terminal` 和 alias selector fail loudly。

## Backends 与 cwd

* `real`：本机 PTY Shell。create可传存在且可访问的absolute cwd；省略时精确使用`$HOME`。其runtime cwd初值为launch cwd，随后由server读取实际Shell process cwd并同步。Room UI的New shell不弹路径框、不发送cached path，只请求server继承当前最高index Shell的live cwd并跳过Text；没有Shell或probe不可用时使用`~`/`$HOME`。
* production `real` Shell不改写`HISTFILE`，依照server进程的用户环境读写全局Shell history，因此可与Konsole等本机终端共享。所有官方自动化test harness必须在启动任何real PTY前强制`HISTFILE=/dev/null`：当前测试Shell的in-memory history仍可使用，但不读取、不写入用户`~/.bash_history`。这是test-only process env，production backend不包含test mode、path猜测或自动history cleanup。
* `fake`：确定性测试 Shell backend，遵循同一 cwd/identity contract。
* `text`：同步纯文本 terminal，没有 cwd，完整保留用户正文。

cwd属于单个Shell terminal，不属于Room、Macro或server。执行`cd`会改变live cwd；拖拽不改变process，但会改变哪个Shell是最高index。cwd变化只发送轻量runtime event，不重发replay、不持久化，server不在terminal cwd写`.shell-deck`数据。它递增live room/terminal revision，但不属于Macro使用的terminal structure revision。

上述继承只适用于用户点击New shell；Macro Prepare创建Shell时始终显式使用`$HOME`，避免把某个live terminal的路径写成Macro含义。

terminal tab与pane header使用同一个canonical单行label：`index · terminalId · [current cwd ·] kind · status`。Text省略cwd；两处内容一致并ellipsis，完整值放入title，pane header可选择复制。

## Replay 与客户端

server 维护每个 Shell 的 2 MiB byte-bounded replay tail，Text 不截断。PTY output 在 server batching 后广播；每个 WebSocket 有独立 64 MiB backpressure queue。browser 再按 animation frame 合并连续 output，并以 generation-aware write pump 驱动 xterm，避免大历史一次性加载时逐 chunk 重渲染。完整 replay/replace 写入 xterm 时属于历史 hydration，必须在 parser callback 确认全部消费前关闭 stdin，使历史中的DA、cursor、OSC color等terminal query不能产生新的PTY input；hydration完成后的live append恢复正常query response。不得通过删除escape sequence或全局丢弃xterm response实现该边界。

Room与每个terminal分别维护单调roomRevision/terminalRevision；Text另有textRevision，每次PTY output或Text正文变化另推进outputActivityRevision。quiet判断使用activity revision，不能比较已截断replay的长度。Room snapshot/index map只在不旧于browser已观察roomRevision时安装；terminal-specific event按launchId + terminalRevision合并，跨HTTP/WebSocket的延迟snapshot不得回滚新真值。

Text browser每个terminal串行一个full-state write，后续输入coalesce为latest value并带local edit generation。只有前进的textRevision和匹配正文才能确认在途echo；确认时若generation已变化，即使最终文字与旧值相同也要重发latest。旧own-echo不能覆盖较新输入，observer只消费server revision。

真实PTY runtime root及其bin/etc必须是当前uid拥有的0700 non-symlink directory；helper/bashrc必须是当前uid拥有的0700/0600 regular file。helper不按mtime信任既有文件，而在每个process首次使用时通过verified temporary、fsync和atomic rename安装。just stop使用包含pid、serverInstanceId和Linux process start time的strict JSON PID record，并在start time与精确server argv均匹配后才发送signal；任何identity读取失败都fail closed。

selected terminal严格属于browser-local state。Room snapshot、terminal snapshot与其他client创建terminal的广播只能更新terminal集合，不能改写已有且仍有效的active terminal。发起New Shell/Text的client在create成功后单独收到不含client identity的`terminal_created`消息，并只在该client选择新terminal；observer不收到该消息。当前没有有效selection时，client本地选择排序后的第一个terminal。

最后一个 client 断开不会销毁 Room。晚到 client 收到当前 snapshot/replay；Destroy 或 server shutdown 才关闭目标 Room 的 terminal/process。

## Single-controller

同一Room任一时刻只有一个controller。fresh generation中第一个完成WebSocket握手的client自动取得控制；其余连接是observer。observer继续接收snapshot/output/replay，可以选择terminal、滚动、复制和修改browser-local Settings，但Shell input、Text edit、terminal create/close/reset/reorder/resize等shared mutation同时由UI readonly和server统一guard拒绝。

顶栏显示`Control: This device`、`Read-only · Take control`或`Reconnecting · Read-only`。Take Control使用确认时看到的controlEpoch，成功后旧owner立即收到`room_control_lost`；release、disconnect或30秒TTL到期只进入available，不自动提升普通observer。若同一browser tab在reload或短暂重连前就是controller，它可在5秒窗口内保存非secret session intent，并仅在server已广播available时自动执行正常epoch-bound acquire；它不保存grant、不自动takeover，也不能抢走另一个live controller。owner server每10秒用WebSocket ping/pong续期，browser timer不承担authority。

HTTP shared mutation使用仅owner可见的clientId/controlLeaseId/controlEpoch bearer，并逐请求复核live owner WebSocket、Room generation和lifecycle。grant只在内存中存在，不进入observer message、Room list、Trace、URL或localStorage。Home New/Destroy是generation-bound process lifecycle operation，不要求目标Room controller；Destroy仍先关闭admission并撤销control/content lease，再清理runtime。
