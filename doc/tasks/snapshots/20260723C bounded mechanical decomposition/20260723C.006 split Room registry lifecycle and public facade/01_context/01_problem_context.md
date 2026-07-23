# Problem Context

## 当前问题

manager的public delegation本身合理，但registry lifecycle仍与数十个facade method同文件：root ensure、random/lazy route create、summary、capacity、active lookup、generation collision、destroy single-flight和broadcast teardown。

这些操作构成一个明确domain，可通过现有map和backend/control hook ports抽出，而不改变caller或建立第二个Room store。

## 拆分选择

manager继续实例化唯一`rooms`和`clients` map并对外保留现有readonly property。registry coordinator接收这些reference以及generation/active-run/destroy资源ports。这样既得到薄facade，也不推翻`20260723B`冻结的single-state truth。

不把terminal structure mutation并入registry；它仍由manager作为跨backend/Room queue gateway装配，避免registry知道Macro run lock。

## 风险边界

所有Room creation path必须共用capacity和generation collision guard。Destroy必须绑定expected generation、拒绝重复destroy，并在begin后让所有admitted work看到abort；remove Room/client只能发生在drain与resource close阶段完成时。
