# Review Result

## 当前状态

.032 Foundation Gate 已通过，代码已落地。本结论只覆盖Room/User Data Root/storage foundation；该revision不是standalone release candidate，也不宣称Macro Integration完成。.033、.034、.035仍需依次完成各自Gate。

## 实际代码映射

* `src/lib/generatedId.ts`集中生成并strict校验typed prefix + 22位Base58 UUID-v4后缀；Room URL token使用独立route assertion，但复用同一identity contract。
* `server/userDataRoot.ts`建立用户级root、0700目录、0600文件/temporary、phase-aware atomic replace/delete、fsync与canonical resource lock；`server/sharedContentStore.ts`交付generic `MacroRecord`、post-publish authoritative reconciliation与optimistic revision底座。rename/unlink后的directory fsync故障不会再让已发布record向上伪报失败，notification等严格调用方仍保留原fail-loudly行为。
* `server/notificationConfigRelocation.ts`只对冻结的notification配置执行target-scoped跨进程锁、raw-byte relocation和conflict fail-closed；运行时只读取新路径。
* `server/terminalRoomManager.ts`、`server/roomTerminalStore.ts`与`server/httpServer.ts`实现ephemeral multi-Room、Home双态、32 Room容量、generation-bound Destroy、lifecycle ticket/drain、真实PTY清理与canonical routing。
* `src/App.svelte`、`src/lib/terminalRoomClient.ts`与workspace组件实现Home/New/Open/Destroy、Room URL同步、断连/Destroy reconciliation、Shell/Text terminal和browser-local settings。
* `server/realPtyBackend.ts`通过PTY helper child PID读取Linux `/proc/<pid>/cwd`；`server/terminalRoomManager.ts`维护last-observed live cwd、quiet-edge refresh与轻量`terminal_cwd`广播。Room UI New shell只发送`cwdSource: "last-shell"`，server-side跳过Text、刷新最高index Shell并继承其current cwd；没有Shell/probe失败时使用`$HOME`，浏览器不弹dialog也不回传cached path。
* review follow-up：Room与terminal wire state新增单调roomRevision/terminalRevision/textRevision/outputActivityRevision；browser分别按Room完整snapshot与terminal-specific ordering domain合并，旧HTTP snapshot/WS delta不能覆盖较新真值。terminal-quiet可直接消费output activity，不再依赖bounded replay长度。Text editor用单在途全文写入与local edit generation coalesce后续输入，确定性`a -> ab -> a` delayed own-echo仍发送最后generation且不回滚textarea。
* replay hydration follow-up：切换Shell/Text会重建xterm并写入历史replay；历史中的Codex同类DA、cursor与OSC color query此前会再次触发`onData`并污染已返回Bash的PTY。`TerminalSlot`现在从完整replace开始到parser callback完成期间设置`disableStdin`，历史回放零输入副作用；live append恢复正常响应，不删除或改写replay escape sequence。浏览器回归用离线真实PTY query fixture先确认live四类响应，再连续三次重建Shell并断言零新增`terminal_input`。
* PTY runtime follow-up：runtime root/bin/etc逐级`lstat`并验证uid/0700，helper与bashrc只接受owned regular 0700/0600文件；helper不再按mtime信任旧binary，而是每process首次使用verified temporary + fsync + atomic rename。PID file破坏性切换为绑定pid/serverInstanceId/Linux start time的strict JSON，`just stop`只有start time与精确Bun server argv同时匹配才signal，读取失败fail closed。
* history-isolation follow-up：production real Shell继续使用用户环境的全局history；`package.json`官方leaf `test:unit:core`与`test:integration`、`scripts/runPlaywright.ts`、Playwright webServer及直接real-PTY fixtures在spawn前强制`HISTFILE=/dev/null`，aggregate只组合leaf entry。静态回归锁定两个公开leaf script都携带隔离环境；最终stack直接运行`just test-integration`为39 pass、0 fail，运行前后真实`~/.bash_history`时间戳保持不变。backend不硬编码test policy且会原样接受调用方override；修复未读写或自动清理既有history。
* `src/lib/terminalDisplay.ts`集中canonical `index · terminalId · [cwd ·] kind · status` label；terminal tab与Shell/Text pane header复用同一字符串、单行ellipsis/title，header可选择复制且terminalId不重复。
* `server/agentEventIngest.ts`与AgentEvent store实现Room/generation/terminal/launch membership校验；`scripts/shell-deck-codex.ts`在缺少Room runtime context时fail loudly，不产生unbound evidence。
* 旧config/Project/Deck/Directory scope、terminal alias/rename、Prompt/layout server persistence、Macro V2 API/editor/runner和对应legacy recipes/tests已按current-schema-only hard cut删除；Macro V3由.034一次性恢复。
* 上述旧production panel删除仅是schema cutover中间态，不是UI redesign决定；`.031`仍作为.033-.035的presentation/interaction reference。后继不得恢复旧schema，也不得以本task删除文件为理由重画无关UI。

## Gate证据

* `just check`：TypeScript通过；`svelte-check`为0 error、0 warning。
* `just build`：Vite production build通过，无warning。
* review follow-up最终`just test-032`：109 unit、21 integration、8 Playwright，全138项全部通过；新增覆盖phase-aware record publish、revision monotonicity、满tail等长activity、Text delayed own-echo、历史terminal query hydration零回灌、runtime symlink/helper、strict PID identity与真实SIGTERM cleanup。全量Gate继续由所有leaf强制`HISTFILE=/dev/null`，未把fixture写回用户history。
* `just test-031b`在rebase后首次失败于`.032`替换`package.json`时漏接script；这是意外测试基础设施漂移，已恢复入口。随后保留`.031B`原始1041行journey作为历史证据，并新增`comprehensiveUiBehaviorCurrent.spec.ts`作为后续workspace唯一演进目标。
* current inventory实测18个source controls、19个runtime controls；相对`.031A`的239个runtime controls共有227个预期移除和7个预期新增，234项全部记录`.032`归因。Macro/Prompt/Run V2中间态移除、fake terminal与alias/rename删除按contract更新测试；Room/terminal surviving behavior不豁免。
* current UI-only journey不调用内部terminal mutation fixture，从空Room通过可见控件覆盖Notice两种dismiss、Settings两种close、真实Shell命令与live cwd、Text 160行/scroll/copy、尾部Text后的New shell cwd继承、tab keyboard/drag/close、双tab server sync及Home New/Open/Refresh/Destroy/empty lifecycle；测试通过且无外部网络请求。
* 后续`.033` current journey发现observer在controller新建terminal后被强制切换active tab，违反本task的browser-local selection contract。修复在本`.032`落地：collection snapshot不再选中新项，create发起者单独收到`terminal_created`并选择；integration证明observer不收到该message，UI dogfood证明observer继续停留在Text。该项属于意外代码漂移，不通过修改`.033`测试掩盖。
* integration覆盖两个process竞争同一MacroRecord/notification target、Room routing与capacity、真实PTY生命周期及`cd` live-cwd probe/New shell server-side继承、WebSocket multi-client同步及37 MB backpressure exact-once。
* browser覆盖Home生命周期、同一用户多tab同步、New shell零cwd dialog、`cd /tmp`后tab/header实时label与尾部Text存在时仍继承live cwd、Fake大回放、真实PTY 37 MB最终marker、terminal reset generation隔离，以及live terminal query正常响应但历史replay重建零输入副作用。
* browser settings已破坏性切换为strict v2，删除`autoPrepareTerminals`字段/default/persistence；旧shape不读取或迁移。
* permission测试覆盖新建0700/0600、既有宽权限root warning、notification symlink/non-regular/broad-permission fail-closed和非notification既有内容不擅自改mode。
* phase-aware publish故障测试覆盖replace/delete的parent-directory fsync在point-of-no-return后失败；底层receipt明确标记durability uncertain，MacroRecord Create/Update/Delete重读authoritative truth后均只返回一次成功。
* notification测试覆盖raw-byte preservation、不同cwd/process single winner、identical source cleanup、conflict不覆盖及source等于target时不自删。
* lifecycle测试覆盖active -> destroying -> destroyed、关闭admission、abort admitted operation、等待异步backend退出、stale generation和server shutdown清空全部Room。

## 审阅结论与残余边界

* P1：0；P2：0；本task已知Foundation Gate blocker：0。
* executable/current tests静态扫描未发现可达旧config/project/Deck route、旧ID生成器、external hook fallback、spool/import、notification dual-read或Macro duplicate/clone route。明确的negative fixtures与notification唯一迁移源不算兼容路径。
* .033必须实现Room controller、HTTP owner bearer grant和跨Room/process content edit lease，并补lease transition/record commit forced-interleaving；.032未提前声称这些能力。
* .034必须原子接回MacroDefinitionV3、CRUD/editor/Prepare/Start/run snapshot，并补Destroy与Prepare/Start durable bootstrap forced-interleaving；.032未保留临时Macro schema或旧runner。
* .035必须在同一User Data Root与content transaction primitive上实现单一user-level Library，不得重新引入Directory/Project scope。
* stack/release Review必须检查.033-.035各自记录的UI文件修改理由与有意偏离；不做截图像素Gate，但无新contract理由的布局/视觉/交互变化属于scope violation。
