# Execution plan

## 阶段一：局部authoring defaults与presentation

* 修改唯一Parallel node factory默认值，不触碰parser或saved records。
* 把当前Flow depth传入Parallel pane，并复用既有四种semantic rail class。
* 保持pane DOM identity、tab/control order、terminal policy和draft mutation gateway。

阶段验收：focused unit/E2E证明默认fail、pause仍可选、root/nested rail颜色正确。

## 阶段二：受控Close all

* 扩展exact ClientMessage与parser。
* 将Close all纳入terminal structure message分类；在同一serialized operation中冻结terminal ids、复用close lifecycle，并批处理index projection。
* 在run dock加入theme-native destructive button、disabled state与native confirmation；Prepare只缩短可见标签。

阶段验收：protocol、manager/WS integration与E2E覆盖confirm/cancel/controller/lock/mixed terminal deck。

## 阶段三：真值与回归

* 同步Macro、Room active specs、Quickstart与control/structure inventory。
* 运行focused与完整Gate，侦探式审阅diff、async boundary、disabled bypass和批量partial failure。
* 写`04_review`并确认当前jj change `conflict=false`。

## 文件与风险边界

不引入generic bulk mutation abstraction。Close all只组合既有terminal positions、single close、structure queue与index-map batch；前端不循环发送多条close message。所有project-authored code继续不超过400行，接近上限的facade通过小而清晰的组合方法保持职责边界。

## 验证顺序

所有命令严格串行：

1. `just check`
2. `just build`
3. `just test-unit`
4. `just test-integration`
5. `just test-20260729b`
6. `just test-e2e`
7. `just diff-check`
