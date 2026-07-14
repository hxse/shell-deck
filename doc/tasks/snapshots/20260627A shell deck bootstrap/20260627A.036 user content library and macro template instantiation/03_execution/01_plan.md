# 20260627A.036 Execution Plan

## 阶段零：UI reference与touch manifest

1. 从.034交付态记录workspace的Macro/terminal/panel位置、比例和visibility/width ownership；这些默认不改。
2. 从.031的`PromptPanel.svelte`、`WorkspaceShell.svelte`、相关CSS和browser tests提取可继续使用的panel shell、header/status/reset-width、toolbar/editor、notice/error/dirty、focus/keyboard与textarea交互。
3. 建立逐文件UI touch manifest，把工作分为：presentation直接保留/移植、必须替换的旧Prompt wiring、为Library新状态所需的局部调整、禁止触碰的无关区域。
4. 先移植仍兼容的presentation结构，再接current Library types/store/API；不得通过旧类型adapter、dual schema或整页重写来缩短实现。

阶段验收：每个计划修改的UI/CSS文件都有task-local理由；没有把.032的临时删减态当作最终UI蓝图，也没有把.031旧数据contract带回当前实现。

## 阶段一：Library record、store与search

1. 将Prompt panel替换为Library，建立Macro JSON、Prompt、Note三tab shell与browser-local state。
2. 实现单一user-global LibraryItem exact schema、(kind,itemId) canonical key、.032 path/shared store CRUD与process-local invalidation；record mutation使用canonical path-derived transaction guard。
3. 接入.033 per-record content edit lease和Room controller；lease transition与record commit共用同一个.032 guard，active lease由owner server续期，saved item默认read-only，New无existing lease。Update/Delete逐字消费published commit的`value + leaseOutcome`：record已发布时始终广播authoritative truth，lost outcome只让editor转read-only。
4. 实现q trim/empty、四字段case-insensitive substring、updatedAt desc/itemId asc稳定排序和无pagination的server search。
5. 删除scope/move/Directory/Global以及旧Prompt storage/routes。

阶段验收：同一record跨Room/process只有一个editor、不同record可并行；revision/lease任一过期零写入；search不受filesystem order或client实现影响。

## 阶段二：Library UI与clipboard

1. 在既有Prompt panel外壳与workspace视觉语言内实现Library三tabs、New/Edit/Save/Cancel/Done/Remove/Refresh及selected/base/draftRevision/dirty/editLeaseId/operationGeneration lifecycle；Save保留Edit session并推进lease base revision，New Create后取得fresh lease才继续编辑；保留panel位置、宽度/visibility/reset-width职责和header/status/toolbar/editor层次。
2. pending时editor inert；tab、selector、New统一进入operation generation，在lease release await前立即pending，并在每个await后复核controller/lease/revision/kind/selection/draft object identity；stale navigation continuation与remote update/takeover都不得覆盖draft。`content_record_changed`另按sequence排队到operation settle后replay，旧Save response不得吞掉更晚Save/Delete。
3. Library panel组件保持常驻，visibility只控制布局显示且不丢selection/draft/lease；Library dirty与Macro dirty/JSON Edit聚合到唯一native `beforeunload`，业务draft不进入browser storage。
4. Copy严格选择persisted或draft content；clipboard resolve才显示Copied，reject显示clipboard_write_failed且state不变。
5. 删除Duplicate/clone/Import/Export/copy-and-create UI/client/store/route；相似内容只走New/browser Paste/Save。
6. Macro JSON提供行号与Validate；Prompt/Note保持任意text。
7. Macro/Library visibility入口统一成同一switch presentation；side-panel resize收窄为6px透明hit area与2px竖线。除此之外仅为tabs、list/read-only/lease/validation/Load状态局部调整Library内部布局，不改动Macro/terminal层次或整体panel比例。

## 阶段三：消费validator与Load into Macro

1. Library Macro Validate/Save/Load把content原文直接交给.034 `parseAndValidateMacroDefinitionJson`并逐字消费invalid_json position或invalid_macro_definition issues；删除caller direct JSON.parse/native-message解析、task-local/private rule copy及issue改写。
2. 实现POST /api/templates/from-library，重读exact source revision并经.034 Macro store创建fresh MacroRecord；source foreign lease不阻止只读Load。
3. Load request验证.033 Room controller，但body不接收Room且server route不调用Prepare/Start。
4. 捕获Macro editor selected/base/draftRevision/dirty/JSON/editLeaseId/operationGeneration guard；response后逐项未变化且clean才切换。
5. clean unchanged时只自动选择，dirty/locked/state-changed只创建并通知；两条路径都不得调用Prepare，后续显式按钮与Library operation完全解耦。
6. Macro toolbar增加`Save to Library`，允许合法的New/dirty/read-only visual draft经现有Library Create创建fresh Macro JSON item；验证无Macro save/selection/dirty/Library selection/Prepare/Start副作用。

## 阶段四：测试与hard cut

1. 补Library schema/key/path/revision/lease/search/clipboard、invalid_json稳定UTF-16 position/invalid_macro_definition与validator exact result/issues caller unit tests。
2. 补two-process lease、canonical guard forced-interleaving、CRUD、Save-retains-Edit、New fresh-lease、Load fresh identity、source immutability和clean guard integration tests；注入publish后lease-state write/delete fault，验证HTTP/broadcast/storage一致。
3. 补three-tab UI、foreign editor readonly、stable search、clipboard reject与clean/dirty Load browser E2E；用人为延迟lease DELETE稳定覆盖tab/selector/New navigation race，并覆盖Save pending时切tab拒绝；再用`route.fetch()`先commit并扣住A response，覆盖自身ack、B更高revision Save及Delete的replay；迁移仍适用的.031 panel width/visibility/reset-width、focus/keyboard、dirty/notice与textarea行为断言，不建立截图Gate。
4. 增加just test-036，执行.032-.035完整回归、`.031B`防漂移Gate、residue scan和git diff --check。
5. 对照UI touch manifest审计所有UI/CSS diff；无task理由的workspace、Macro、terminal或global-style改动必须撤回。
6. Close Gate后同步active specs、guide、README与AGENTS。

## 实施约束

* current-schema-only hard cut，不添加旧Prompt/Library migration、scope alias或dual route。
* Library不读取terminal/cwd/notification config或Trace；Load server route绝不Prepare/Start。
* Library Macro content只允许纯MacroDefinitionV3，不伪造tmpl_、revision或timestamps。
* .034拥有Macro object/text validator；.036只新增text caller，不能直接JSON.parse、重定义position/rule/code或policy。
* Copy只写clipboard中的当前content；Duplicate/clone/Import/Export/copy-and-create不存在。
* canonical identity在store/API/client/event/lease全链路都是(kind,itemId)。
* lease不替代revision，revision不替代lease；client readonly不替代server enforcement。
* shared mutation和lease transition使用.032同一个canonical resource transaction guard；不新增第二把record/lease lock，cross-process不声称live push。
* controller/content lease只由owner server基于live WebSocket续期；browser没有renew authority或public renew route。
* 创建MacroRecord成功与client是否自动选择分开判断，不能因dirty draft丢失已创建结果；Load从不进入Prepare phase。
* .031只提供presentation/interaction reference，旧Prompt schema/store/API/scope不得以复用UI为名回流；.034是Macro/terminal直接基线，不因Library实现重排。
* UI改动遵守touch manifest：必要的Library内部变化可做，无理由的panel比例、toolbar、全局CSS、字体、颜色、图标或其他成熟交互变化不得做；不要求截图或pixel一致。

## 验证顺序

1. Library schema/key/path/store/search/edit lease、canonical guard、validator text exact result/position/issues与clipboard unit tests。
2. CRUD/revision/controller/lease/broadcast/Load API integration tests。
3. Library UI、统一toggle/resize presentation、Copy failure、no-Duplicate/Import/Export、dirty lock、Macro JSON、Macro draft Save to Library与clean/dirty Load browser E2E。
4. UI touch manifest审计及既有panel width/visibility/focus/keyboard/dirty/textarea行为回归；确认Macro/terminal层次和主要控件顺序未被Library改写。
5. just check、just build、just test-036与just test-031b。
6. legacy rg扫描与git diff --check。
