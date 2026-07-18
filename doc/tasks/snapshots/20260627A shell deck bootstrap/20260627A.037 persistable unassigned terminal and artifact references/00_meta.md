# 20260627A.037 Persistable Unassigned Terminal And Artifact References

## 任务概括

在.034-.036已经落地的Macro editor、MacroRecord、Prepare/Start、server-authoritative runner与Library之上，修正“可持久化模板”与“当前可运行宏”被混成同一状态的问题。用户应当可以先搭建Send、If、Extract或Parallel结构，再补terminal和earlier artifact；保存MacroRecord或Library素材不应被迫完成所有动态引用，但Start不能猜测、忽略或用空字符串代替未指派引用。

本任务破坏性切换到`MacroDefinitionV4`。`{kind:"unassigned"}`是definition JSON中的真实tagged-union branch，不是browser内部变量、runtime constant、缺省字段、空`stepId`、`null`、`0`或magic string。它只进入两个封闭类别：terminal target与必填Action artifact source。matcher、op、text、scope、delivery、ending、optional default source以及Parallel Output的`none`均保持各自真实语义。

## 正式 task 级别及定级原因

三星任务。

它改变持久化Macro schema、唯一text validation gateway、visual defaults/selectors、Macro/Library Save、Prepare、Start、server runner防御与大量fixtures。错误实现可能让未完成宏静默运行、把真实空值误当placeholder、让Library拒绝可复用半成品，或重新引入V3/空source兼容分支，因此需要完整Document/Code/Test Gate。

## 范围内

* 新建唯一current schema `MacroDefinitionV4`，`schemaVersion`精确为4；V3 fail loudly。
* terminal reference使用`{kind:"terminal_index",index}`或`{kind:"unassigned"}`；不再使用primitive `terminalIndex`字段。
* required artifact source使用`{kind:"step_artifact",stepId,artifact}`或`{kind:"unassigned"}`。
* Send、Input、terminal-quiet Wait、Capture、Parallel lane统一使用terminal reference。
* If/Elif condition、root/lane Extract及Send/Notify artifact message part统一使用required artifact source。
* artifact message part的`source`变为required；删除缺省source在runner中变成`""`的行为。
* 建立persistable、runnable、live Room三层唯一验证入口与stable issue code。
* Macro Create/Update/JSON Save和Library Macro JSON Save/Load接受persistable unassigned definition。
* Start在client与server双重拒绝任何unassigned reference；runtime绝不消费或转换该branch。
* Prepare只消费V4当前draft/JSON buffer内已形成的`terminalLayout`，不解析或补齐unassigned。
* 每个eligible selector把`Unassigned`作为真实可选项；局部显示warning和解决提示。
* 每个允许Unassigned的新引用slot无条件以该branch初始化；已有compatible terminal/artifact只进入候选列表，不得自动代选。
* 更新`.031B`后继current journey、Macro/Library E2E、unit/integration与active specs。

## 范围外

* 不建立generic `MaybeAssigned<T>`并扩散到所有字段。
* 不允许matcher/op/text/scope、regex、ID、template、delivery、ending或notification level使用unassigned。
* 不把optional `Input.defaultSource`缺失变成unassigned；缺失继续表示明确没有default source。
* 不把Parallel Output `{kind:"none"}`变成unassigned；`none`继续表示用户明确选择无lane artifact输出。
* 不把真实空字符串或运行时空artifact解释成unassigned。
* 不自动选择、创建或Prepare terminal，不自动创建producer Action。
* 不提供V3 reader、migration、Convert、alias、dual validator或legacy fixture兼容。
* 不修改Room、controller、content lease、Library identity/storage、run persistence或notification secret配置。

## 决策归属

人工已拍板：

* persisted branch精确写作`{kind:"unassigned"}`；不得用`key`、internal variable或magic scalar表示。
* unassigned只表示terminal来源与Action artifact来源这两类有限引用插槽。
* If只把`source`设为unassigned；matcher/op/text/scope保留真实配置。
* Unassigned是selector内的真实可选项，用户可以主动清除已指派引用。
* unassigned definition可Save到Macro与Library，但不可Start。

AI可直接实现：

* V4 exact types/validator/parser、UI selector/warning、Save/Start/Prepare/runner调用链和测试。
* 移除V3、empty-stepId与optional artifact-source运行兼容。

需要人工拍板：无。
