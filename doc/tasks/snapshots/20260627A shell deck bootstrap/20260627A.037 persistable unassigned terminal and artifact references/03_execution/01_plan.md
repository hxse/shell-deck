# Execution Plan

## 阶段一：schema与验证

1. 破坏性替换MacroDefinitionV3为V4，落地terminal/artifact exact tagged unions。
2. 删除primitive terminalIndex、empty-stepId与optional artifact source production types。
3. 将唯一gateway拆为persistable与runnable completeness，冻结stable issues。
4. 更新layout authoring与runtime binding，只消费assigned terminal reference。

阶段验收：unit覆盖V3拒绝、白名单unassigned round-trip、assigned invalid仍失败及deterministic runnable issues。

## 阶段二：Visual/JSON editor

1. 更新terminal selector为reference value，Unassigned始终可选并显示slot warning。
2. 更新If/Elif/Extract/message artifact selectors，删除空stepId placeholder。
3. 所有允许Unassigned的新terminal/artifact slot无条件写unassigned；compatible候选只供用户显式选择。
4. JSON Save使用persistable gateway；Macro状态区分valid与incomplete。

阶段验收：空Room与空artifact scope均能纯UI构建、Save、再次读取；Start准确禁用。

## 阶段三：server、runner与Library

1. Macro CRUD、Prepare、Start与runner snapshot全链路切换V4。
2. server Start先做runnable validation并保证零mutation failure boundary。
3. runner删除missing source空字符串分支并加入unassigned defensive rejection。
4. Library Validate/Save/Load切换V4 persistable gateway并呈现valid-but-incomplete。
5. Macro List逐record扫描：valid V4继续列出，V3/损坏record返回stable diagnostics并在UI可见；显式Read仍fail loudly，不增加reader/migration。

阶段验收：API round-trip、Load fresh identity、unassigned Start零run，以及fully assigned runtime通过。

## 阶段四：测试与文档收口

1. 机械更新所有current V3 fixture为V4 exact refs；不得保留builder兼容层。
2. 新增Macro/Library纯UI unassigned journey及Start server boundary integration。
3. 增加valid V4与V3/损坏record共存的API/UI测试，确保单个invalid record不再清空列表且诊断可见。
4. 更新active specs、README/guide与`.031B`后继current inventory/journey。
5. 运行`just check`、build、unit、integration、`.037` E2E、`test-031b`和`git diff --check`。
6. hard-cut扫描V3、primitive persisted terminalIndex、empty-stepId与missing artifact source runner fallback。

## 实施约束

* `{kind:"unassigned"}`直接进入JSON；不导出runtime singleton constant、不比较object identity。
* 不借schema更新重画Macro/Library/terminal UI；只改引用selector、warning与validation状态。
* 不用测试helper、normalizer或server adapter接受V3。
* 不把unassigned issue混入persistable error；也不允许Start绕过runnable completeness。

## 实施结果

四个阶段均已完成。production、current fixtures、Macro/Library UI、server Start与runner已经统一切换到V4；`.031B`不可变历史基线未改，后继current inventory/journey仅按本任务的真实schema差异更新。最终Gate与残余风险记录在`04_review/01_result.md`。
