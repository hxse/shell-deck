# 20260627A.011 Flow Control Redesign

* 父任务：`20260627A shell deck bootstrap`
* 状态：draft-doc
* 类型：ux-architecture-redesign
* 目标：把 macro GUI 和 template schema 中的普通动作与流程控制解耦，设计接近 Python 心智模型的 block-tree 流程控制。
* 非目标：本任务只冻结设计和迁移边界，不在本 change 中落地 runner/UI 实现，不删除旧模板兼容能力。
