# 20260723C.001 Split Evidence Segment Storage and Validation

## 任务概括

`server/evidenceStore.ts`当前565行，同时实现公开run/artifact store、segmented JSONL append/recovery/prune，以及event/summary exact codec。本task只按这三个既有职责拆文件，不改变任何落盘字节、目录、错误或调用顺序。

## 正式 task 级别及定级原因

三星任务。append publish point、partial-line recovery、directory fsync、retention prune和summary maintenance debt都属于durability语义，移动错误会让一次已发布event被误报失败或让summary与segment窗口 quietly diverge。

## 范围内

* 新建segment storage模块，承接JSONL append、partial-line recovery、segment path/read/list/prune primitive。
* 新建record validation模块，承接provenance、event、summary exact codec与intent equality。
* `EvidenceStore`继续是唯一public store/API owner，负责run lifecycle、cursor、maintenance orchestration和artifact入口。
* 保持所有目标文件不超过400行。

## 范围外

* 不改User Data Root、run目录、segment size/retention、summary schema、artifact naming或error code。
* 不改`MacroRunStore`、runner protocol或Trace UI。
* 不引入database、stream abstraction、generic record codec或compatibility reader。
