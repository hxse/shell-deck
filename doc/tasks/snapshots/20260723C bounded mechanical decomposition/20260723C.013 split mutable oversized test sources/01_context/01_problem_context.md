# Problem Context

## 当前问题

两个Room文件由多个独立test自然组成，按scenario移动即可。Macro comprehensive则是一个从空Room开始、通过可见UI构造复杂Macro并执行的连续journey，不能粗暴切成互不相关的smoke。control inventory混合历史constant、current source digest、runtime ID和数百行evidence attribution。

## 拆分选择

Room按test case原样移动；Macro保留唯一top-level test，按现有`test.step`顺序调用多个显式helper，每个helper保留原expect与操作；control inventory原路径变成re-export facade，数据按只读职责拆。

现有journey inventory只扫描top-level test AST，helper化后必须扩展为“case + declared helper sources”的attributed inventory，继续证明相同expect/route/wait数量，而不是接受下降后的新digest。

## 基线

`.012`完成后的current journey基线必须至少保持：

* 51个unique test title；
* 657个`expect`；
* 27个route；
* 20个wait；
* 所有forced Gate、唯一显式`waitForTimeout`上限与no skip/only规则。

具体pre-split digest在实施时从`.012`父change生成并作为迁移evidence保存。

## Historical边界

`comprehensiveUiBehavior031B.historical.ts`不是current test，也不被Playwright发现；当前唯一consumer只是校验整文件raw-byte digest。`jj`历史已经提供完整恢复能力，因此本task直接删除这份退役源码与hash-only oracle，不拆成新源码、不建立例外。`controlInventoryHistorical.ts`保存的结构化`.031A` source/runtime truth仍参与current inventory Gate，不能删除或放宽。
