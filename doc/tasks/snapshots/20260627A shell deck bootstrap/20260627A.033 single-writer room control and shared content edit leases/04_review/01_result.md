# Review Result

## 当前状态

实现与Close Gate通过。.033已落地Room single-controller、owner-only HTTP bearer、server heartbeat、跨Room/process content edit lease及observer readonly consumer primitive；未提前实现`.034/.036`的Macro/Library业务UI。

## 实际代码映射

* `server/terminalRoomManager.ts`与`src/lib/roomControl.ts`：Room generation内controller state machine、personalized safe view/grant、epoch-bound acquire/takeover、TTL/ping-pong、lifecycle ticket及统一WS/HTTP authorization复核。
* `server/httpServer.ts`与`src/lib/terminalRoomClient.ts`：current-schema-only control/content endpoints、owner bearer解析、所有现存shared WS mutation统一guard、browser memory-only grant和explicit Take Control；旧`POST .../control` acquire route不可达。
* `server/contentEditLeaseService.ts`与`src/lib/contentEditLease.ts`：canonical resource key、30秒lease、same `.032` per-resource transaction guard、revision-bound sync commit、cross-process filesystem truth及Room/control丢失清理。
* `src/lib/protocol.ts`与`src/lib/generatedId.ts`：safe controller/content invalidation message及统一`control_`/`edit_` generated ID。
* `src/App.svelte`及五个workspace/terminal样式或组件文件：只增加controller状态、Take Control、同tab reload/reconnect的5秒bounded available acquire和server-truth readonly；session marker不含grant，普通observer仍不自动提升。完整逐文件理由已记录在execution UI touch manifest。
* `tests/unit/*033*`、`tests/integration/*033*`、`tests/e2e/singleWriterRoom033.spec.ts`及受影响`.032` E2E：覆盖projection、bearer、epoch/TTL、Destroy interleaving、same/different record、two-process winner、双tab readonly/takeover、controller tab reload连续性及37 MB replay回归。

## 审阅结论

* shared terminal create/input/Text edit/resize/reorder/close/reset全部从WebSocket握手clientId进入同一server guard；snapshot/replay维持只读。
* observer不收到`controlLeaseId`或owner identity；grant只保存在browser client内存。伪造、wrong Room、stale epoch、旧takeover确认及Destroy期间的在途takeover均fail loudly。
* content lease transition和record revision commit复用同一canonical resource transaction guard；同record互斥、不同record并行、跨process单winner。Save保留当前Edit session lease，Done/Cancel/selection/New/Delete/unmount/control loss才释放；release/expiry不自动提升等待者。
* record atomic replace/unlink现为明确point-of-no-return；record parent-directory fsync在publish后失败时由`.032`重读核对authoritative truth并继续成功，随后lease-state刷新/清理故障返回authoritative saved/deleted value与`leaseOutcome: lost`，不再返回虚假的正文失败，且旧editLeaseId不能继续提交。后继Macro/Library route必须广播正文真值并把该editor转只读。
* Home Destroy仍是generation-bound lifecycle exception；它先关闭Room admission，再撤销controller/lease并清理PTY，不要求另一个Room的controller。
* UI有意偏离仅为topbar controller状态/Take Control和轻微readonly内描边。terminal label、tab排列、正文布局、Settings local control均保持；observer draft/Text不清空，Copy/scroll/tab selection仍可用。

## Gate结果

* `just check`：通过，TypeScript与Svelte均为0 error / 0 warning。
* `just build`：通过；143 modules，主JS 402.63 kB（gzip 109.92 kB），无bundle warning。
* `just test-unit`：通过；118 unit与24 integration，0 failure。
* `just test-032`：底座已在`.032 @ 9eae8900`独立通过；本change不以旧计数替代当前Gate。
* `just test-033`：通过；121 unit、24 integration、9 browser，包含record/lease-state publish后fault injection、same-Room、多Room、two-process、Text delayed echo与37 MB real PTY Gate。
* `.031B` current inventory在本task为19个source controls、20个runtime controls；相对`.031A`有227个预期移除、8个预期新增，其中`take-control`归属`.033`，另有6个surviving controls记录controller-only semantic attribution。
* 未适配current Gate首先以19-vs-18 source mismatch发现Take Control，属于预期结构变化。后续用户实测证明reload把刚才的controller tab变为observer会令全部shared controls看似无故灰掉；现收敛为同tab在5秒窗口内仅对available自动执行epoch-bound acquire，另一设备仍需显式Take Control，普通observer仍不自动提升。
* current journey随后发现observer会因controller新建terminal而切换active tab；这与single-writer无关且违反`.032`browser-local selection，已切回`.032`以发起者专属`terminal_created`修复并通过`.032`全Gate，未在本task放宽断言。
* takeover后的旧controller明确收到control-lost Notice；current journey先验证并通过既有dismiss layer关闭，再证明旧页仍可select/read/copy而新controller继续Text edit、keyboard selection、drag reorder与close。最终`just test-031b`通过。
* `git diff --check`与current-schema静态扫描：通过。

## Warning与残余边界

* `.034/.036`尚未存在Macro/Library mutation surface；它们必须直接消费本task的controller ticket与content lease commit primitive，不得复制第二套lock或TTL语义。
* 产品仍是默认localhost、显式LAN且同一可信用户模型；single-writer不是账号认证或多人权限系统。
* 按已拍板语义不设terminal产品级数量上限；backend/OS资源失败明确报错，不做partial自动修复。
* Bun force-stop在transport promise未及时settle时采用250 ms bounded drain后`unref`；Room admission、content lease和PTY cleanup已在返回前由manager完成，不从日志恢复runtime。
