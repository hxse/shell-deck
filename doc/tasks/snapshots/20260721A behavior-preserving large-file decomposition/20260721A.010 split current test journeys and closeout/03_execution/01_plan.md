# Execution Plan

## 阶段一：inventory

为四个primary文件生成test/step/gate/assertion/spec映射，保存拆分前运行结果和失败诊断形态。

## 阶段二：E2E拆分

按Room、Library、Macro三个domain逐组移动完整test case。每次只移动，不重写；透明helper另立文件并逐consumer审阅。

## 阶段三：integration拆分

按runner lifecycle/execution/Prepare/evidence/terminal fault domain移动case，保持fixture isolation和fault injection ordering。

## 阶段四：整链closeout

1. 对照inventory证明零遗漏、零弱化。
2. 依次重放.001-.009 focused Gate。
3. 运行全量static/unit/integration/PTY/E2E/visual与`.031B`Gate；E2E必须走目录级current自动发现，并以曾遗留Room的前序spec紧邻Home inventory spec的顺序额外证明文件隔离。
4. 审查最终diff只包含behavior-preserving organization change。
5. 在本任务与各子任务`04_review`记录证据；有任何行为差异则不通过Close Gate。
