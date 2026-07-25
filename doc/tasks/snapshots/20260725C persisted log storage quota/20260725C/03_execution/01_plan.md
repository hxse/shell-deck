# Execution Plan

## 阶段一：Quota owner

新增单一`LogStorageRetention`，只持有limit、canonical roots、GC lock、current-run pin与run adapter。fresh scan统计两个日志root，按terminalized run再closed AgentEvent segment执行oldest-first deletion；atomic admission让同一lock覆盖durable publish，不缓存第二份usage truth。

## 阶段二：Run integration

`MacroRunStore`继续是run evidence业务facade。它向quota owner提供authoritative terminal candidate与whole-run tombstone deletion，对current Room run安装/替换/释放跨process pin，并让manifest、Trace index known mutation/cold rebuild、artifact、run event/summary全部经过atomic quota admission。Trace写入固定按quota → trace取得锁，GC后重新构造index内容；不修改Trace payload或runner状态机。

## 阶段三：AgentEvent segmentation

把AgentEvent file append/rotation/scan提取到小型segment storage。`AgentEventStore`继续唯一拥有event indexes/waiters，对外match/list/version API不变；segment owner只管理current layout、逐line atomic admission、complete JSONL append和带close mtime的open/closed transition。

## 阶段四：Server wiring与current docs

server按explicit option或environment解析limit，构造quota、run store和AgentEvent store后在bind前执行startup check。Room Destroy/server stop关闭对应open segment。同步run log/user data/architecture active spec及Quickstart。

## 阶段五：串行验证与审阅

严格顺序运行focused、`just check`、build、完整unit、独立integration、Chromium E2E与diff-check。随后审查删除竞态、legacy residue、line count、文档和jj conflict，写`04_review`与task index。

## Legacy Kill List

* 无总量边界的completed run/artifact集合；
* 单个`<roomGeneration>.jsonl`无限追加AgentEvent layout；
* GC逐文件破坏run完整性的路径；
* 依靠mtime删除active/interrupted run或open AgentEvent segment；
* quota不足时继续写或静默丢日志；
* 对旧flat AgentEvent JSONL的migration、alias或dual read。
