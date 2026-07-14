# 20260627A.036 User Content Library And Macro Template Instantiation

## 任务概括

在.032的User Data Root/shared-store/generated ID、.033的Room controller/per-record content edit lease，以及.034的production MacroRecord CRUD/MacroDefinitionV3/唯一validator/selection contract上，把现有Prompt面板替换为通用Library面板。

这里的“替换”只授权Library内部信息架构和数据行为的必要变化，不授权重画整个workspace。实现必须以.034最终形成的Macro/terminal workspace为直接继承基线，并以.031的`PromptPanel.svelte`、`WorkspaceShell.svelte`及其交互测试作为Prompt面板外壳、尺寸归属、toolbar/editor视觉语言和输入手感的presentation reference；旧Prompt schema/store/routes/scope语义不属于reference，必须按本task hard cut。除下文明确列出的Library差异外，既有panel位置与宽度职责、工作台比例、按钮/输入框/textarea/notice视觉语言、focus/keyboard/dirty交互及Macro/terminal区域默认保持。

Library保存Macro JSON、Prompt、Note三类长期、无Room/runtime/cwd绑定的user-global内容。三类位于同一个用户级Library，不存在Directory/Global scope；都支持New、Edit、Save、Cancel/Done、Copy、Remove、Refresh和稳定search。saved item默认read-only；Edit/Save/Delete必须取得.033按(kind,itemId)派生、由owner server续期的per-record lease并携带expected revision，record commit与lease transition共用.032 canonical per-resource transaction guard。Save提交revision但不结束Edit session，clean session由Done退出。Copy只把当前content写入clipboard，不复制metadata、不创建item；Duplicate/clone/Import/Export/copy-and-create不存在。

Macro JSON是纯MacroDefinitionV3，不包含tmpl_ record id、revision或timestamps。Validate、Save和Load把原始content逐字交给.034唯一`parseAndValidateMacroDefinitionJson`：JSON parse错误返回稳定invalid_json position，definition失败返回invalid_macro_definition及原顺序issues；.036不自行JSON.parse，不拥有、改写或复制validator。Load into Macro每次创建fresh MacroRecord；source item不改写。Macro editor保持clean且operation identity未变化时创建后自动切换；dirty、JSON edit、content lease或pending状态只创建、不切换。两种路径都零Prepare，用户需要时在Macro面板显式点击`Prepare terminals`。

## 正式 task 级别及定级原因

三星任务。

本任务新增长期持久化schema、跨process shared store、content edit lease接入、HTTP/WebSocket protocol、Library UI/dirty state、稳定全文search与from-library创建链路。错误可能覆盖用户长期内容、误报clipboard成功、绕过Macro current schema或覆盖未保存Macro draft，因此需要完整context、spec、execution、review、人工Document Gate和browser/API/two-process Gate。

## 范围内

* 将Prompt panel替换为Library panel，提供Macro JSON、Prompt、Note三个内部tabs。
* 三类item统一支持list/search/read/new/edit/save/cancel/copy/remove/refresh；Copy精确为clipboard-only并处理失败。
* saved item默认read-only；Edit取得.033 Library resource lease，owner server负责renew，Save在同一lease上推进base revision并保留Edit session，Done/Cancel/Delete释放；Save/Delete在.032同一个resource transaction guard内同时验证lease与expected revision。
* New draft在首次Create前无itemId或existing-record lease；create仍要求当前Room controller，成功后取得fresh record lease才继续编辑，失败则保留saved item并明确转read-only。
* 不实现Library Duplicate/clone/Import/Export/copy-and-create API、按钮或client/store方法；相似item走New → browser Paste → Save。
* 逐字复用.032的User Data Root、canonical path-derived resource transaction、shared-store primitives与generated ID factory/validator。
* Library是单一user-global collection；删除scope、Directory/Global/All filter与scope move。
* Library record canonical identity固定为(kind,itemId)；collision reservation和.033 lease key都按kind隔离。
* Macro JSON只保存.034 MacroDefinitionV3，不保存MacroRecord metadata或physical terminal identity。
* 只消费.034唯一Macro definition text validation gateway；不在本task JSON.parse、提取、迁移或复制parser/validator规则。
* Load into Macro调用.034 production Macro store创建fresh MacroRecord；source definition不改写，且不命名为Duplicate。
* clean Macro editor创建后自动选择；dirty/JSON/edit-lease/pending/revision变化只创建并通知。两者都不得调用Prepare。
* 冻结q normalize、匹配字段、稳定排序、无pagination的V0 search contract。
* 增加Library browser-local state、store/API/protocol/E2E与legacy scan。
* 先建立UI touch manifest，逐项区分从.031/.034保留的presentation、必须替换的Library wiring，以及本task有明确理由的局部调整；manifest外的workspace视觉或交互改动不在范围内。

## 范围外

* 不修改.032 User Data Root、Room routes/lifecycle、notification config、Macro path、generated ID encoding或browser storage ownership。
* 不修改.033 controller/edit lease identity、owner-server renewal、TTL、takeover或filesystem coordination；只消费primitive，不新增browser renew入口或第二把record lock。
* 不修改.034 MacroDefinitionV3、validator规则、terminalLayout、Prepare/Start、run snapshot、Trace或structure lock。
* 不重新设计.034的Macro/terminal布局、panel比例或toolbar，也不借Prompt→Library迁移统一重写全局CSS、组件库、图标、字体、颜色或spacing。
* Load route不接收body roomId，不直接调用Prepare/Start。
* 不新增Macro placeholder、terminal mapping、source-record identity或兼容token。
* 不恢复旧Prompt store/routes/files/panel兼容入口。
* 不提供Directory/Global scope、cloud sync、跨OS用户同步、cross-process live push、Library version history、pagination或rich text。
* 不迁移旧Prompt/Library/Macro data，不提供dual read、Convert、fallback或automatic import。

## 决策归属

人工已拍板：

* Library是无状态、跨Room且可被同一User Data Root多个server process共享的user-global内容。
* Library与当前selected Macro完全独立；切换Macro或Room不改变Library。
* 同一saved Macro/Library record不允许跨Room/process同时编辑；一个editor，其余只读。
* Copy只复制当前content原文到clipboard，不复制title/description/tags/record metadata，也不创建item；不提供Duplicate。
* Macro JSON保存纯MacroDefinitionV3，terminal reference仍只有index/type。
* Load遇到clean editor时创建并切换；dirty editor时只创建、不切换。
* Library canonical identity采用(kind,itemId)。

AI可直接实现：

* 三tab Library UI、统一CRUD/stable search/clipboard-only Copy/Refresh与process-local invalidation。
* .033 content edit lease/revision/controller接入、owner-server renewal、.032单一resource transaction guard及跨Room/process只读状态。
* 删除Library Duplicate/clone/Import/Export/copy-and-create surface，并验证New/browser Paste/Save。
* 调用.034唯一text validator的Macro JSON Validate/Save/Load，保持stable invalid_json position/invalid_macro_definition分层并原样透传issues。
* Load fresh MacroRecord、precise clean/dirty operation guard，以及与.034显式Prepare按钮完全解耦。
* 旧Prompt/scope/source-record/validator-copy兼容分支的current-schema-only删除和全部Gate。

需要人工拍板：无。
