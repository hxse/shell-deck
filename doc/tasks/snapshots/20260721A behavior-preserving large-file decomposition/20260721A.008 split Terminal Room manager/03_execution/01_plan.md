# Execution Plan

## 阶段一：ownership inventory

记录Room record字段、每个public method、serialized queue、revision推进点、PTY callback identity和broadcast时点。补state transition characterization。

## 阶段二：value objects

先抽replay buffer、runtime discriminated types和pure snapshot projection；manager仍负责所有mutation与broadcast。

## 阶段三：coordinators

1. 在不新增queue的前提下抽terminal mutation coordinator。
2. 抽lifecycle admission/drain/cleanup，继续使用manager持有的Room record与queue。
3. 每步删除旧branch并做forced-interleaving验证。

## 阶段四：收口

确认外部consumer只依赖manager facade，内部无shadow registry/duplicate revision/broadcast。运行real PTY、multi-client、runner和TUI完整Gate。
