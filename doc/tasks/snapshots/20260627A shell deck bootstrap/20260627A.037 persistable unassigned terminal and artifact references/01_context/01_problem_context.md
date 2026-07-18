# Problem Context

## 当前问题

V3把“definition结构可保存”与“所有运行引用已经完成”混为一个portable validation。Visual editor虽然允许先插入If或Extract，但没有earlier artifact时只能写入空`stepId`的伪source；该状态不是合法JSON，Save与Library Save都失败。terminal-bound Action没有terminal时也只能保留primitive index的非自洽状态或显示`No terminals available`，用户无法把半成品当真正模板保存。

反方向还存在一个隐式例外：Message artifact part的`source`是optional，runner遇到缺失source直接产生空字符串。这让同样的“未选择引用”在If中阻止Save，在Send/Notify message中却静默运行，既不统一也容易把配置错误伪装成真实空输出。

## Unassigned到底表示什么

`unassigned`不是“表单还没填完”的通用空值，而是：

> 一个运行必需、必须由用户从其他对象中选择、但当前尚未绑定的reference slot。

只有两类满足：

1. terminal target：引用Macro logical terminal index，最终Start再解析为Room runtime terminalId/launchId。
2. Action artifact source：引用exact earlier compatible Action output。

If的`matcher.kind=simple`、`op=contains`、`text=""`、`scope.kind=whole`都是完整真实值。尤其`text=""`与artifact实际输出`""`均有运行语义；把它们视为unassigned会使equals-empty、contains-empty等条件无法明确表达。

## 为什么不是Node级placeholder

一个If在source尚未选择时，用户仍可配置matcher、scope与branch body；一个Send在terminal尚未选择时，用户仍可编辑message/delivery/ending。若把整个If/Send变成placeholder，会隐藏或丢失这些已经完成的配置。正确粒度是对应selector slot本身。

## 为什么需要三层验证

V3只有portable与live Room两层，但unassigned既不是schema错误，也不是Room mismatch：它是definition内部明确保存的“尚不可运行”状态。因此V4拆成：

* Persistable：exact schema与所有已指派引用内部自洽；允许unassigned。
* Runnable completeness：所有运行必需引用均已指派；不读取Room。
* Live Room：已指派terminal index在当前Room存在、type/capability/readiness匹配。

Save只回答长期内容能否安全保存，Start回答当前是否可执行。Prepare仍只调整terminal layout，不代替引用选择。

## current-schema-only边界

这是一次明确的hard cut。V3 record、`terminalIndex` primitive、空`stepId`、missing artifact source与任何adapter均不是V4输入。旧输入按唯一gateway返回稳定invalid definition；实现不自动转换历史文件，也不同时写两种schema。
