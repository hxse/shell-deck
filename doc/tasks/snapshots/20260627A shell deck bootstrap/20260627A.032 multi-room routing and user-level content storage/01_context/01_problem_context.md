# Problem Context

## 当前问题

现有 configId 同时被当作 terminal runtime namespace、Macro storage bucket、Prompt/layout scope 和 URL 参数。后续提案又试图用 Project/canonical working directory 拆解它，但这仍然把 shell-deck 错误建模成“打开一个目标项目”的工具。

真实使用场景相反：一个 Macro 可以同时操作多个 terminal，而这些 Shell terminal 可以分别位于不同仓库、不同目录，甚至运行完全不同的程序。把 cwd 绑定到 Room、Macro 或 Library，会降低 Macro 的可移植性，并产生没有真实业务含义的 Project registry、Directory scope、切换规则和路径层级。

## 重新定义产品边界

shell-deck 编排 terminal，不编排目标项目。长期内容与实时 Room 应独立：

    User Data Root
    ├── Macros
    ├── Library
    └── read-only Trace / artifacts

    Server process
    └── Room A / Room B / ...
        └── Shell(cwd X), Shell(cwd Y), Text, ...

Macro 和 Library 是同一 OS 用户可复用的无状态内容；Room 是某个 server process 内的 memory-only 实时会话。Macro 可以在任何 Room 中被选中，后继 .034 根据当前 Room 的 terminal index/type 准备和校验运行环境。两者不通过 cwd、projectId、roomId 或 server URL 绑定。
同一 Room 的 multi-client 能力服务于同一用户的多标签页、多设备查看和接续操作，不建立用户、成员、权限或协作编辑模型。支持口径是任一时刻只有一个客户端主动操作，其他客户端同步观察。.033专门把跨客户端controller和跨Room/process内容编辑租约覆盖到所有共享mutation；.032只保留server queue/revision作为底层防损坏边界。


## Room 与 URL

roomId是随机路由token，不是持久化对象，也不存在特殊main Room。根地址/是Room Home：当前process没有live Room时，server在Room manager临界区创建一个随机room_<22-char-base58>并以302 Found与Cache-Control: no-store重定向到/<roomId>；已经存在Room时，/直接显示Room Home，不再生成新token。

Room Home列出当前server process的全部live Room，并在同一页面提供New、Open、Destroy和Refresh。New或Open都让当前Home页面跳到目标/<roomId>。Room工作区顶栏只提供Home按钮，并在新标签页打开/，因此当前Room连接不受影响。刷新或分享具体URL会进入同一Room；若token合法但runtime不存在且尚未达到容量上限，则创建同token的新generation。最后一个客户端断开时Room仍保留，直到用户在Home显式Destroy或server停止。Home销毁最后一个Room后保留空列表；只有重新请求/才自动创建首个Room。Ctrl+C、SIGTERM或正常server stop都调用同一destroy-all路径。server restart后再次访问旧token只会创建新的空generation，不能从URL token、Trace或旧terminalId假装恢复原runtime。

Root首建与Home New的roomId由server生成；用户直接访问一个格式、UUID version与variant都合法的/<roomId>时，该URL token是允许lazy-create的唯一caller-provided identity例外。server只能验证token格式，不能证明它曾由自己生成。Destroy则以active/destroying/destroyed lifecycle barrier关闭新mutation、abort并drain在途operation后才移除Room，避免异步PTY spawn或Start在销毁后复活runtime。

V0每个server process最多保留32个live Room，不做idle TTL或后台自动回收。Room manager把根地址首建、Home New、合法旧URL lazy ensure和Destroy放入同一串行临界区；达到上限时New与不存在的Room URL稳定返回room_capacity_reached，已有Room仍可进入，Destroy完成后才释放容量。这样既不让暂时断开的Room意外消失，也不会让重复访问无限增长live runtime。

## 统一 generated ID

当前源码已经用 short-uuid生成 terminal、launch、template、run和event等ID，但每个模块各自创建translator，Prompt还截断后缀，client使用自增数字，校验器也只检查宽松字符集。这会让新 Room再次增加一种格式，并让日志、URL和持久化record的identity contract继续漂移。

本任务把short-uuid升级到6.0.3，并由一个公共模块独占library import。所有server生成的opaque identity使用同一个22位Flickr Base58编码UUID v4后缀，不截断、不自定义alphabet、不使用Math.random、时间戳或进程计数器；实体类型只通过room_/term_/launch_/tmpl_/run_/evt_/lib_等prefix区分。

“统一”不等于把所有名字随机化。Flow node的send/send_2、if branch、parallel lane与terminal index属于用户可读或模板局部引用，继续使用各自的deterministic/local规则；artifact path和临时文件名也不是public entity identity，但其随机suffix必须复用同一generator。

## cwd 的正确位置

cwd 属于单个 Shell terminal 的live runtime property，launch cwd只是初值。真实Shell执行`cd`后，server从实际Shell process重新读取resolved current cwd并向同Room clients同步；它不是由浏览器猜测、解析prompt或持久化得到。Room UI的New shell不询问路径，也不发送cached path，只发送继承最后Shell的意图；server按当前authoritative顺序找到index最大的Shell、在创建前强制刷新其current cwd并继承。Text没有cwd并跳过。Room中没有Shell或live probe不可用时精确使用`~`对应的当前OS用户`$HOME`。底层create protocol仍可为明确的内部/测试caller传absolute cwd。Macro Prepare补出的Shell始终使用`$HOME`，不继承现有terminal。

一个 Room 内不同 Shell 的 cwd 可以不同；拖拽 terminal 不改变process或terminalId，但index变化后会改变哪个Shell属于“最后一个”。current cwd更新是runtime telemetry，不改变terminal structure revision。cwd 不进入 Macro、Library、Room identity、内容路径或 readiness 判断，也不在 server restart 后恢复。

terminal tab和terminal pane header必须显示同一条canonical单行label：`index · terminalId · [current cwd ·] kind · status`。Text省略cwd。tab允许截断但tooltip保留全文；header允许用户选择复制全文。不能重复terminalId、拆成多行或让cwd/status使用另一套拼接规则。

## 持久化边界

server管理的长期内容只有Macro、Library，以及只读Trace/artifact/AgentEvent evidence。用户手工维护的notification-profiles.json作为独立secret/config保留，不属于Macro、Library或产品级Server Profile。它从当前legacy path迁到User Data Root，但JSON schema与文件字节不变。浏览器只保存UI preference。Room、terminal、Text buffer、replay、runner cursor、snapshot和structure lock全部只在内存中存在。

多个server process指向同一User Data Root时共享前述文件，因此store必须支持跨process原子写和optimistic revision；它们仍各自拥有完全隔离的Room runtime。Macro/Library record mutation与后继content edit lease transition还必须按同一canonical record path进入同一个短生命周期resource transaction guard，避免takeover与Save分别拿锁后交错提交。Trace用于审计和查看，不用于恢复runner。

这些用户级文件可能包含Telegram token、Prompt、Macro与terminal evidence。V0在POSIX上以0700创建受管目录、以0600创建普通文件和atomic temporary，并对已有宽权限root发出不泄密warning；notification secret若为symlink、非regular file或group/other可访问则单独fail closed，而不阻止Room等无关功能。

Macro是跨task的阶段性交接。.032只建立MacroRecord envelope、固定path和shared-store primitive，不切换production Macro API/editor/runner，也不发明临时definition schema。.033先建立Room controller与共享内容编辑租约；.034定义唯一MacroDefinitionV3，并把CRUD、editor、runner与底座原子接通。因此.032的Foundation Gate可以独立验证，但.032 revision不是standalone release candidate；stack/release Gate必须包含.034的完整Macro Integration。

## 破坏性切换

本任务采用current-schema-only hard cut。旧r_<21-char> Room ID、宽松/截断/计数型system ID、模块私有shortUuid translator、/r/:roomId、/ws/r/:roomId、固定main、/p/:projectId/r/:roomId、/api/projects/**、configId routes/files、Directory/Global Library scope、ProjectRecord/ProjectRegistry和project-local data都直接成为非法输入。唯一明确例外是notification config的byte-preserving path relocation；它不转换schema、不保留dual read，也不构成通用legacy migration。除此之外没有alias、migration、dual read、自动导入或兼容字段。

.032只冻结Room routing、user storage和状态ownership；.033冻结同一Room单写控制与跨Room/process内容编辑租约；.034冻结Macro对terminal的引用与运行安全；.036冻结通用Library。后继任务不得重新引入Project、Directory scope或target cwd abstraction。

AgentEvent live capture 只能来自 shell-deck 创建的 Shell terminal。runtime 注入 Room/terminal/launch 与 ingest context，server 验证后才允许当前 Room 的 Macro 消费；普通外部 terminal 缺少该 context，just codex 必须在启动 Codex 前 fail loudly，不生成 manual identity、unbound evidence或可导入 spool。
