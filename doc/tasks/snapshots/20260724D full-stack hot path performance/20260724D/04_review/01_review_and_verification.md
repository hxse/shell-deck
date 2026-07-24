# 20260724D Review and Verification

## 总体判断

同时审阅代码和文档后，20260724D 的Formal Document、Code、Test、Current Docs与Close Gate均满足。实现使用current-schema-only替换Text、Runner和Trace旧live contract；Macro、AgentEvent、Room projection及局部复杂度优化均保持各自唯一truth owner，未引入dual schema、兼容分支或第二份持久化状态。

三轮审阅期间发现的P2/P3已在本change内修复并重新通过完整Gate。当前无未解决P1/P2/P3、warning或需要用户拍板的问题，可以关闭本任务。

## Gate 结论

| Gate | 结果 |
| --- | --- |
| Task-scoped unit/integration | 54项通过 |
| Task-scoped Chromium E2E | 7项通过 |
| `just check` | 通过；TypeScript/Svelte 0 error、0 warning |
| UI style residue | 通过 |
| Production build | 通过；403 modules |
| Full unit入口 | 266 unit（含6项theme foundation）+ 55 integration通过 |
| Independent integration | 55项通过 |
| Full Chromium E2E | 59项通过，单worker |
| Project file-size | 346个project-authored code文件全部不超过400行，0 exception |
| Diff check | 通过 |
| jj conflict | `nkysvnvm`为`conflict=false` |

## Findings and Solutions

### 1. P2 / L1：Text repair budget最初未绑定launch identity

同一terminal reset后若沿用旧launch的repair次数，新launch可能失去允许的一次full repair；旧launch迟到message也可能污染新launch预算。已把budget与`terminalId + launchId`绑定，identity切换时重置pending/attempt，旧launchmessage直接忽略，并以unit覆盖reset与迟到消息。

### 2. P2 / L1：Runner action ack最初仍携带不必要的runtime input正文

Start/input action response若回显prompt、default text或draft，会在HTTP和WebSocket两条路径重复搬运状态；input按钮快速重复触发还可能产生两个submit。已把ack收窄为identity、revision、status及紧凑waiting input identity，client以已发送本地值推进cursor，并以single-flight直到WebSocket确认。integration与E2E验证第二次click不产生第二个request。

### 3. P2 / L1：Trace session最初在Room mount预取summary

这违背“进入Trace view才加载”的冻结contract，也会让完全不看Trace的Room承担历史索引请求。已删除mount预取，仅由view transition触发summary page；E2E记录Room mount/reload的Trace request数始终为0。

### 4. P2 / L1：terminal runner publication失败路径最初可能保留live cache

terminal durable event已提交后，若最后一次projection发送失败或Room被销毁，cache仍必须淘汰，否则长期server会积累completed run window。已在terminal publication attempt的`finally`释放cache，并保留durable evidence作为后续Trace/full repair来源。

### 5. P2 / L1：旧structural oracle仍冻结被本任务替换的protocol与DOM

旧测试仍要求`setTextContent` facade、close后的完整`room_snapshot`、全量160行gutter，以及未登记Text/Trace DOM和diagnostics rune。未删除或放宽测试；保留20260723C与20260722A baseline原文件，在current oracle中登记精确20260724D delta、current facade surface、source digest与fingerprint。定向oracle复核34项通过，完整unit再次通过。

### 6. P2 / L1：新性能E2E读取terminal ID存在异步创建竞态

测试点击`New text`后立即读取`.last()`；server较忙时第二个tab尚未投影，会把Shell ID误当Text ID，造成reload后的假失败。已在读取identity前增加exact terminal count barrier，并以综合journey后紧接性能用例的最小复现组验证2项通过，随后完整E2E 59项通过。

### 7. P2 / L1：Text异步hash最初可能安装reset/reconnect前的旧projection

mutation或repair在`await sha256Text()`前捕获的terminal可能已经被新Room snapshot替换。已为每次accepted full Text projection分配进程内不可复用的monotonic token，并在每个hash await后重新读取和核对Room generation、token、backend、launchId与textRevision；stale结果既不安装正文，也不请求repair或消耗新projection budget。controllable-hash unit覆盖不同launch reset以及同launch/revision、显式coordinator reset后的ABA场景。

### 8. P2 / L1：Trace分页最初仍枚举和读取页外segment

valid `summary.json`曾因通用summary recovery路径读取首尾segment，event page也曾先枚举完整segment目录。已增加Trace专用valid-summary fast path，并由event sequence数学计算精确segment filename；正常summary page为零segment read/list，event page只读覆盖目标页的segment。integration以真实storage callback统计文件read/list，而不是只统计facade调用。

### 9. P2 / L1：derived Trace index最初会被另一server process的旧cache覆盖

process-local read-modify-write无法保护共享User Data Root。现在manifest record/remove在同一cross-process SQLite resource lock内重新读取disk truth、merge并atomic replace；reader以device/inode/size/mtime generation检测外部atomic replacement并重新加载。两个独立Bun process并发publish的integration证明两项都保留，预先加载空index的observer无需restart即可看到它们。

### 10. P2 / L1：Runner required full snapshot最初重复clone definition

publication的每次run-start/connect/reconnect/repair snapshot都调用`structuredClone(run.definition)`。现在Start strict clone创建live run时即递归freeze该唯一definition projection，所有full snapshot直接复用；普通delta继续不含definition。unit连续获取两次snapshot并断言definition reference相同且root/body均frozen。

### 11. P3 / L1：current run终态后Trace最初退回旧persisted event page

UI曾只在active status选择runner window，状态变为completed/failed/stopped便切换到进入Trace时加载的旧页。现在selected run ID与current runner相同时继续选择runner retained window，不依赖active status；unit冻结terminal transition后的final event仍可见，以及选择其他run仍使用其persisted page。

### 12. P3 / L1：同run cursor越过event tail最初返回伪合法空页

cursor codec只检查非负整数，storage未比较current summary tail。现在读取任何segment前先验证`afterEventSeq <= lastEventSeq`，越界稳定返回`invalid_trace_event_cursor`；integration同时断言错误路径为零segment read。

### 13. P2 / L1：Trace fast path最初会信任stale-but-valid summary

`summary.json`只在run start、segment boundary、retention和终态checkpoint；进程若在普通event后退出，或终态summary maintenance失败后重启，schema仍合法但event tail/status已落后。现在每个process/run首次cold Trace summary访问读取首尾segment验证freshness，必要时atomic修复summary并建立fresh marker；成功checkpoint同样建立marker，同进程新append会使其失效。unit模拟普通event加终态summary写失败后“重启”，首次Trace恢复`failed`与seq 3，第二次访问segment read/list均为0。

### 14. P2 / L1：已知Trace index增删最初触发全量manifest rebuild

新manifest先落盘后，旧index与目录集合必然暂时不一致，原writer因此把每次Start误判成cold rebuild并解析全部manifest。现在writer在cross-process lock内fresh-read index、应用本次已知upsert/remove，只比较结果ID集合；缺失、损坏或存在无关集合漂移时才cold rebuild。20-run fixture证明正常add/remove manifest parse均为0，额外注入未登记manifest后才精确解析22份manifest。

### 15. P2 / L1：dirty recording Proxy最初可被splice写回live draft

array mutation从get trap取到嵌套Proxy后，set trap曾原样写回；反复move会形成Proxy-on-Proxy并保留旧changed map。tracker现在跨`apply()`以weak mapping识别自己创建的Proxy，并在set边界递归unwrap root与nested values。50次实际`moveNodeAtPosition`来回移动后，每个body element仍严格等于原node reference，dirty swap/revert结果同步保持true/false。

## 需要人工拍板

无。Text使用单段replacement patch、`expectedTextRevision + resultHash`；Runner使用definition-once full snapshot与hashed delta；Trace使用summary/event两级cursor pagination，均按用户已确认方案实现。

## AI 可直接修

三轮审阅发现的十五项均已直接修复并完成focused与full regression验证，没有遗留待修项。

## 未覆盖与残余风险

1. Text每次实际网络mutation仍对完整candidate计算SHA-256，复杂度为O(N)。当前2MiB payload、20,000行UI和coalescing已有覆盖；若未来正式支持几十MiB持续编辑，应另立任务评估chunk hash或Worker，不能在本contract内增加Merkle/operation tree。
2. completed run、artifact和AgentEvent磁盘总量仍不设全局retention；本任务只消除查询与live cache的无界放大。删除evidence属于破坏性retention policy，需要独立正式任务。
3. Gate覆盖本机Chromium、PTY、WebSocket、进程竞态和1000-event/1000-node/10,000-node规模，但不等价于数日soak或LAN多client压力测试。
4. sandbox内一次production build无输出卡住，终止该次本任务启动的进程后，在sandbox外连续构建通过；未观察到源码、依赖或生成物异常。

## 审阅范围

审阅`nkysvnvm`相对父revision的全部106个变更文件，包括正式task四阶段文档、active specs、Quickstart、Macro diagnostics/dirty、AgentEvent store/wait、Text protocol与UI、Room projection/broadcast、Runner publication/hash/repair、Trace index/API/UI、artifact index、send queue、现有oracle与新增unit/integration/E2E。

同时检查Legacy Kill List、project-authored code行数、current-schema-only边界、public/durable schema边界、controller与lease guard、revision/hash commit顺序、repair single-flight、hard action flush、Trace lazy pagination、cache eviction和测试发现入口。未使用测试删除、skip、only、放宽scanner或file-size exception迁就实现。
