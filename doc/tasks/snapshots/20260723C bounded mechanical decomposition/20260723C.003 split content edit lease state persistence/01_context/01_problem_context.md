# Problem Context

## 当前问题

service前275行是业务transaction；后半段混入held/available record构造、过期转换、SHA-256 state path、filesystem codec与view/grant projection。codec和path可独立测试，但不能自行决定谁有权取得或提交lease。

## 拆分选择

新state store只接收canonical record path/resource key并执行read/current/write/delete/revision codec。业务service继续在`ContentResourceTransactions.run`内部按原顺序调用ticket authorization、owned map与state store。

不把transaction整体下沉到repository，因为那会让filesystem layer同时理解Room controller与published content commit，反而形成更厚的隐式domain service。

## 风险边界

Acquire/Takeover在transaction内先authorization，再读epoch/state/revision并写held state；transaction外再次authorization后才track/broadcast。Commit在同步record operation成功后，lease state refresh失败只能标记lost。Delete同样不能因state delete失败伪装record未删除。
