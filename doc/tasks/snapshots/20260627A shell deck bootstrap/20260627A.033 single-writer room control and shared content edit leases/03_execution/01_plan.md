# Execution Plan

## 阶段一：Room controller primitive

1. 在Room runtime中增加controller view/owner-only grant、controlEpoch、30秒TTL与server-owned 10秒WebSocket ping/pong heartbeat，接入握手/断开；删除browser authority renew。
2. 建立统一server-side mutation guard与HTTP owner-only bearer/live-owner-WS/epoch/generation/lifecycle校验、WS context校验，逐项迁移terminal、Text、runner、显式Prepare terminals和content mutation；明确排除client-local Macro selection及.032 Home lifecycle New/Destroy。
3. 实现confirmed:true + expectedControlEpoch绑定的Take Control、expectedControlEpoch available acquire、room_control_lost广播、secret-safe observer projection、await后commit复核与observer UI；release/expiry后不自动提升普通observer，同时为同tab reload/reconnect增加5秒session-intent窗口，只对available自动调用正常acquire且不保存grant/不takeover。
4. 明确只读/local-only操作白名单，避免把scroll、Copy和localStorage preference错误冻结。

阶段验收：same-Room two-client tests证明任一时刻只有一个writer；observer永远得不到grant，伪造/过期/wrong-context bearer及direct API/WS绕过失败，不宣称普通HTTP能识别有效bearer复制；旧epoch确认不能抢走后来owner；background client在WebSocket健康时不因browser timer throttling失权，真正失联在TTL后回收。

## 阶段二：跨Room/process content edit lease

1. 建立Macro与Library canonical resource key、edit lease state，并映射到.032 canonical record path/resource transaction guard。
2. 用同一短生命周期guard实现leaseEpoch、expectedLeaseEpoch acquire、confirmed:true takeover、owner-server renew/release/TTL与record commit，不长期持有OS lock、不另建第二把resource lock，也不自动提升等待者；Save commit保留Edit session lease，Done/Cancel/selection/New/Delete/unmount/control loss才释放，New Create后继续编辑必须取得fresh record lease。
3. 把Room control epoch、editLeaseId与expected revision组合成统一commit guard；每个point-of-no-return前的async commit boundary重新验证。冻结record atomic replace/unlink为point-of-no-return，之后返回authoritative value与`retained/released/lost` lease outcome，不允许post-await controller检查把durable success改写为失败。
4. 增加same-record互斥、different-record并行、two-process、crash residue、takeover、forced-interleaving及publish后lease-state故障注入tests。

阶段验收：同一record跨Room/process只有一个editor；lease与revision任一过期都零写入；owner crash不造成永久lock。

## 阶段三：UI、Home lifecycle交接与后继接口

1. 先记录实际UI touch manifest：只允许Room topbar/controller indicator、Take Control确认、shared readonly/notice primitive及必要consumer wiring；每个文件写明single-writer理由，禁止顺带修改terminal chrome或Macro/Library视觉结构。
2. 顶栏沿用现有button/popover/notice语言增加Control: This device / Read-only · Take control状态；所有共享controls从server truth派生readonly，不隐藏整个surface、不清空draft。
3. 接入.032 Room页Home按钮和Home generation-bound Destroy invalidation；确认Home不取得controller、不出现跨RoomTake control & destroy，active run仍可被lifecycle Destroy。
4. 提供.034/.035复用的client lease API、状态store和错误呈现，不加入Macro/Library业务schema或布局决定。
5. 更新AGENTS、active specs、guide与测试入口，扫描client-only guard、并发旧路径及无理由UI diff。

## 实施约束

* current-schema-only hard cut，不保留“并发也许能用”的旧入口或feature flag。
* controller只约束live Room shared mutation；content lease只约束saved user content record；.032 Home只管理Room lifecycle，三者不互相替代。
* lease不替代revision，revision不替代lease；所有async commit都必须复核两者与Room epoch。
* controller memory-only；content lease/available epoch文件是crash coordination state，不是可恢复产品配置或Trace。
* HTTP grant是owner-only bearer capability，不是账号认证或不可转移channel binding；正确性依赖secret不暴露及逐请求live owner WS/epoch/generation/lifecycle校验。
* 不实现协作用户、账号、权限或cross-process Room sync。
* 不在本任务提前实现Macro/Library editor逻辑；只交付其可复用primitive和tests。
* 不以`.032`暂时删除旧panel为理由重新设计工作台；`.031`只提供presentation/interaction参考，禁止恢复旧schema。除controller/lease必要状态外，既有UI默认保护，不做截图Gate。

## 实际UI touch manifest

* `src/App.svelte`：只增加Room controller状态、Take Control、同tab reload/reconnect bounded acquire、断线只读/重连及既有shared mutation入口的guard；Home、terminal排列、label和Settings结构不重排。
* `src/lib/components/workspace/WorkspaceShell.svelte`：只下传一个server-truth `sharedReadOnly`状态。
* `src/lib/components/workspace/TerminalTabBar.svelte`：observer只禁用close与drag；选择tab、查看title等只读行为保持原样。
* `src/lib/components/TerminalSlot.svelte`：observer禁用stdin及server resize，仍渲染、滚动和选择/复制；重新取得control时强制发布当前PTY尺寸。
* `src/lib/components/TextBoxSlot.svelte`：observer使用原textarea的`readonly`，仍允许滚动、选取与Copy，不清空正文。
* `src/styles/room.css`：只为三种controller状态和shared readonly增加沿用既有视觉语言的最小样式；唯一有意视觉新增是topbar状态控件与轻微readonly内描边。

未触及Macro/Library/editor chrome；`.032`的中间态未提供这些surface，本task不借机恢复、隐藏或重新发明它们，后继`.034/.035`只消费这里交付的controller/content lease primitive。

## 验证矩阵

* focused：Room controller projection/state machine、bearer validation、expected control/content epoch、server heartbeat、mutation/lifecycle guard、shared resource transaction、edit lease store、TTL/takeover/revision。
* integration：same-Room two tabs、background timer throttling、different Rooms、two server processes、Home Destroy与shutdown。
* aggregate：just check、just build、just test-unit、just test-032、just test-033、browser Gate、git diff --check。
* static/review：扫描无guard mutation、client-only lock、browser renew、secret broadcast、header-only authority、独立resource lock、跨RoomDestroy takeover、global mutex、persistent controller、duplicate/clone、await后缺失复核，以及touch manifest外或无single-writer理由的UI/CSS改动。
