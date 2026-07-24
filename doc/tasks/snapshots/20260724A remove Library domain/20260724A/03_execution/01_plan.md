# Execution Plan

## 1. 冻结删除与真实数据边界

* 记录当前change、Library全部code/API/UI/settings/test/current-doc owner与真实数据inventory。
* 验证existing MacroRecord和两个Library macro-template都通过唯一V5 validator，比较definition digest。
* 完成Formal Document Gate后才修改production。

## 2. 删除server与storage domain

* 先收窄generated ID、ContentResourceKey、lease record path和User Data Root。
* 删除Library routes/context/store构造与public server option/result。
* 删除Library store/type source，确认removed API只落入generic 404。

## 3. 删除frontend domain

* hard cut browser settings到v4并保持Theme bootstrap共享validator。
* 删除App/Workspace的Library toggle、panel、resize、preference和dirty aggregation。
* 删除Library component/session/client/coordinator/workflow。
* 从Macro session、mutation/navigation/edit orchestration和toolbar删除双向transfer action。

## 4. 收敛测试与current文档

* 删除只验证Library存在的unit/integration/E2E与fixture。
* 更新Macro、settings、server、UI inventory、structure、theme及test discovery oracle中的有意delta。
* 删除active Library contract，更新README、Quickstart与其余active specs，历史snapshot保持。
* 执行static residue scan，禁止dummy compatibility残留。

## 5. 一次性迁移真实数据

* 在workspace外建立private backup，复制现有`macros/`与`library/`原始bytes并计算digest。
* 用临时、task-local执行脚本验证Library envelope与V5 definition，再调用current `MacroRecordStore.create`。
* read-back新record、再次验证并比对digest；确认existing MacroRecord和Library source bytes没有变化。
* 删除临时执行脚本，只在review记录backup path、source/new identity与digest结果。

## 6. 顺序验证与审阅

* 依次运行focused recipe、`just check`、`just build`、unit、integration、单worker Chromium E2E、file-size及diff-check；重命令不并发。
* 审查完整change、current residue、file-size、用户数据结果与`jj` conflict。
* 修复明显问题后写`04_review`、更新index状态并完成change。
