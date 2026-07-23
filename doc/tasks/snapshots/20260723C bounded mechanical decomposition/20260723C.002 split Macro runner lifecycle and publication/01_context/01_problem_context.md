# Problem Context

## 当前问题

前次拆分已把Flow executor和Action runtime移出service，但service仍有三条独立主链：

* Start到execute/finish/destroy的run lifecycle；
* Pause/Resume/checkpoint/runtime Input的interactive lifecycle；
* runtime revision、snapshot/delta选择与25ms publish timer。

三条链共享一个`LiveRun`，却不需要放在同一文件。继续堆在service会让修改input或publication时必须审阅完整bootstrap transaction。

## 拆分选择

采用domain-specific coordinator，传递同一个live object和明确ports。public service仍负责依赖装配与原API；不建立event bus，不把run序列化成模块间snapshot，也不复制registry。

内部type可以放在单向依赖的live-run model模块，但该模块只定义current in-memory shape，不拥有第二份state或持久化contract。

## 风险边界

Start与finish的durable event是point-of-no-return；structure lock必须精确取得和释放一次。Input submit必须先append durable event，失败时pending request仍可重试。publication只能从当前Room generation/current run发出，event gap必须发送full snapshot而不是错误delta。
