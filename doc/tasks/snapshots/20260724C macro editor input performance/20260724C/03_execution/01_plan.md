# 执行计划

## 阶段一：共享draft mutation热路径

把Visual mutation中的完整draft clone/root replacement改为现有deep rune draft上的同步原地mutation。提取小型、无Svelte state ownership的dirty baseline比较器：只缓存immutable base的JSON投影，mutation后只比较当前draft；record install、New、cancel、published Create和persist成功等所有base切换点必须同步更新基线。

先补pure unit测试冻结object identity、dirty revert、base缓存和异常边界，再接入`macroRecordSession.svelte.ts`。不改变public session shape、guard顺序、revision计数或operation workflow。

## 阶段二：递归editor identity

审计Macro组件全部keyed list和可编辑ID。Flow node容器改用node object；For(text-list)行直接使用item object并删除父Node ID派生key与structure-version registry；Parallel Lane/Action/Output验证现有unkeyed/selected rendering在原地draft下不会重建。所有identity都只存在于editor instance，禁止写入schema或DOM。

补focused Playwright覆盖普通text/textarea连续输入与删除，以及四类ID的完整连续rename、DOM object/focus/caret稳定和零持久化请求。For(text-list)额外冻结父Node rename期间item card、key input与value textarea identity。测试应操作真实Visual editor，不以源码字符串代替行为证明。

## 阶段三：审阅、Current Docs与完整Gate

做一次全Macro输入清单审计，确认所有Visual控件仍走共享gateway，没有残留per-keystroke完整draft clone、editable persisted key、shadow buffer或autosave。同步`macro_template_contract.md`中editor lifecycle与mutation contract，不修改用户指南，因为使用方式没有变化。

顺序运行focused test、`just check`、build、unit、integration、Chromium E2E、file-size与diff-check；每项完成后再启动下一项，避免重命令并发。完成代码到spec映射、diff审查和P1/P2复查后写`04_review`与index最终状态。

## Legacy Kill List

删除Visual mutation中`cloneJsonValue(draft)`后再`draft = next`的热路径、每次mutation重复`JSON.stringify(baseDefinition)`的比较，以及以可编辑`node.id`直接或间接生成递归节点/text-list item key的做法。保留record install/start snapshot等真正需要隔离快照的clone。

## 验收停止线

本任务在确定性unit/E2E行为证明、完整串行Gate无warning/error、所有source不超过400行、current spec与代码一致且未发现P1/P2时结束。进一步的validator增量化、超大Macro benchmark、JSON editor或terminal输入优化只作为后续候选，不扩大本任务。
