# Problem Context

parser 是 AI soft guard，不是系统审计真值。它的输出必须受 schema、profile 和 fixture 约束，且在不确定或不一致时暂停给用户。

把 parser 单独拆出来，可以独立评估 Spark/codex exec 的稳定性，而不和 capture source 或 V0 文档收口混在一起。
