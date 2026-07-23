# Execution Plan

## 阶段一：characterization

* 冻结manager现有public method/type/constant列表。
* 运行Room control、terminal runtime、Room manager、content lease与runtime sync focused baseline。
* 增加静态module-boundary断言：只有manager可在production import两个新coordinator。

## 阶段二：Room control

* 建立`RoomControlCoordinator`与ports，移动ticket implementation、hooks和control helpers。
* manager constructor注入唯一rooms/clients引用、Room lookup/admit/snapshot callback。
* 把全部control public method改为等签名delegate，删除manager内重复实现。
* 先运行Room control/content lease focused Gate。

## 阶段三：Terminal backend

* 建立`TerminalBackendCoordinator`与ports，移动backend factory/env、terminal CRUD callback、replay/revision和cwd lifecycle。
* manager保留Room registry/lifecycle、structure queue/move/lock及projection facade，用显式delegate调用backend coordinator。
* destroy callback继续按原顺序cancel cwd并登记backend close promise。
* 运行terminal runtime/Room manager/real PTY/runtime sync focused Gate。

## 阶段四：closeout

* 扫描旧implementation残留、production direct import与dependency cycle。
* 运行static/build/full unit/integration及相关E2E。
* 同步active architecture/Room contract、review和index，确认`jj conflict=false`后才创建`.002`。
