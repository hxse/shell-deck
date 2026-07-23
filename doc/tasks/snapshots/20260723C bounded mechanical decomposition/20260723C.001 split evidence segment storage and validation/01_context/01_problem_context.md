# Problem Context

## 当前问题

入口前半段是`EvidenceStore`业务编排，后半段则是两套可独立验证的底层职责：约443行开始的private JSONL append/recovery primitive，以及约505行后的provenance/event/summary strict validation。它们共享一个文件并不表示共享state；真正的runtime state只有store中的append cursor与maintenance debt。

## 拆分选择

不把Store改成generic repository，也不让segment module拥有run lifecycle。segment layer只收显式path/value并报告publish/durability结果；codec layer只把unknown验证成current exact record。Store仍决定何时append、何时prune、何时checkpoint summary以及如何恢复cursor。

这样可以在不移动业务state的前提下降低入口长度，并让filesystem failure与invalid-record测试分别对准单一owner。

## 风险边界

最危险的不是类型，而是顺序：partial tail必须在read/append前恢复；complete JSON line写入并fsync后就是published；新segment才要求directory fsync；post-publish错误只能成为uncertain receipt；prune或summary失败进入maintenance debt，不能反转event。任何抽取都必须原样保留这些阶段。
