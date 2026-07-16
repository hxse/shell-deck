# 20260627A.035 Execution Plan

## 阶段一：协议与server publish

1. 破坏性更新`MacroRunnerSnapshot`，加入Room-scoped `runtimeRevision`、`runningMacro`和`runtimeInput`，删除旧flattened字段。
2. 在Room WebSocket注册后发送bounded完整runner snapshot；所有live transition通过统一入口发送state + newly appended event delta，25ms内可合并但不能重复历史event。gap时server/client都回到一次完整snapshot repair。
3. 删除MacroPanel 900ms polling，按generation/runtimeRevision/absolute eventSeq安装WebSocket snapshot/delta；HTTP GET只留Debug与gap repair入口。
4. 增加generic `content_record_changed`，在MacroRecord成功transaction后broadcast；client将pending期间事件按sequence入队并在operation settle后replay，只刷新saved state，不覆盖local draft/selector，也不让旧HTTP response吞掉更晚Save/Delete invalidation。

阶段验收：两个标签页不轮询即可看到同一run；新连接立即同步最近tail；live event sequence只传一次；旧revision与gap不能回退或伪造UI。

## 阶段二：runtime input server ownership

1. 把pending input扩展为invocation id、server draft和input revision，default直接初始化draft。
2. 新增exact input-draft API并破坏性更新submit request；controller、generation、run、invocation、revision逐层复核。
3. client实现单一in-flight/latest-value coalescing，takeover和revision conflict以authoritative snapshot收口。
4. Trace不落runtime plaintext draft，仅记录必要元数据。

阶段验收：Waiting Input、draft和submit跨tab一致；失去control的在途请求不能覆盖新controller内容。

## 阶段三：Home、toast与takeover交互

1. 用Svelte 5 `$effect`实现Home visible interval、focus/visibility immediate refresh和cleanup，删除手动Refresh。
2. 建立App级统一mutation feedback和3秒hover-pausable Notice；把terminal、Macro、runner、runtime input拒绝入口接入。
3. shared mutation按钮从silent disabled切为guarded/aria-disabled；readonly fields继续保护数据。
4. 更新Take Control文案并在成功后清除readonly denial。

阶段验收：observer点击任何明确写按钮都有原因；toast可复制、hover暂停、outside dismiss；Home无需人工刷新。

## 阶段四：通知与双标签页测试

1. 确认Notify server execution和Telegram调用保持exactly once，App/System按在线client广播并按notificationId去重。
2. 增加同URL双tab E2E：Start、takeover、Pause/Resume、Waiting Input、draft、submit、关闭后重新连接。
3. 增加runner revision/delta/gap repair、首次repair GET 500后无后续delta仍自动收敛、bounded tail、Room projection revision、stale terminal readiness、saved-content dirty preservation、延迟Save response期间remote higher-revision/Delete replay、runtime input conflict/coalescing、Home effect和toast unit/integration/component测试。
4. 增加`just test-035`并运行`.032-.035`受影响Gate。
5. 增加Save/dirty Start后run completed仍保留Macro Edit session、释放terminal structure lock，以及同一controller tab reload后普通re-acquire恢复Macro New/terminal New的E2E；另以observer tab证明不会自动提升或takeover。

## 阶段五：文档收口

1. 更新Room/runner/Macro/notification active specs、README和quickstart，明确browser-local/user-global/Room三层状态。
2. 更新本task review，记录代码映射、Gate和残余风险。
3. 审计`.036`仍只负责Library业务，并复用本任务primitive。
4. 执行legacy polling/old snapshot字段扫描和`git diff --check`。

## 阶段六：`.031B`逐change漂移审计

1. 保留`.031B`历史snapshot，只在`.035`加入current inventory；冻结相对`.034`仅删除Home手动`Refresh`这一项预期差异。
2. 运行current workspace与完整Macro纯UI journey；saved record异步确认只通过可观察Save状态与fresh id等待。
3. 将协议要求导致的差异更新在本change测试，将其余失败作为非预期代码漂移修复，禁止通过删断言或放宽用户操作顺序收口。
4. 特别复测同一次页面生命周期中的重复runtime Input：`fill`后立即Submit仍须把latest value发送到server。

## 实施约束

* current-schema-only，不兼容旧runner snapshot/input request，也不保留transition全量events broadcast。
* server publish必须位于state mutation之后，且不得越过Room lifecycle/generation barrier。
* client-local Macro/Library draft绝不被runner或saved-content push覆盖。
* 不借同步重构重画既有Macro/terminal UI。
* 不新增browser-to-browser通道、service worker runtime镜像或runner恢复机制。
