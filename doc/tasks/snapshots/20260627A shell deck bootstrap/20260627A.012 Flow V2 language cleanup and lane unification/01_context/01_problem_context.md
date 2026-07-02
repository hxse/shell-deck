# Problem Context

`.011 flow control redesign` 已经把宏语言方向从 v1 flat steps 推向 Flow V2 block-tree：普通动作和流程控制分离，流程控制使用 `if/elif/else/for/break/continue/return`，`pause/stop` 回到 runner 控制按钮。

但 `.011` 的 validator slice 为了快速落地，`parallel_all` 仍复用了 v1 lane schema。继续沿用这个过渡方案会让新语言边界不干净。

## 当前风险

如果外层 Flow V2 使用 block-tree，而 `parallel_all.lanes[*]` 继续使用 v1 lane 子语言，会形成混合语言：

```text
Flow V2 body
  for / if / return
  parallel_all
    lane A: v1 flat lane steps
    lane B: v1 flat lane steps
```

如果反过来把 lane 也设计成完整 Flow V2 子语言，又会把并发场景复杂化：

```text
parallel_all
  lane A: send -> input_line -> if -> parse -> return
  lane B: send -> user-continue -> nested loop -> return
```

这并不符合当前真实场景。用户需要的是 fan-out / fan-in：给不同终端并发发送命令，等待所有终端完成，抓取每个结果，再统一合并、解析或发给另一个终端。

## 设计结论

Flow V2 必须全面清理旧语法。旧结论“parallel_all lane body 使用完整 Flow V2 block-tree”已经废弃；当前结论是把 `parallel_all` 收窄成受限 fan-out / fan-in action：

* lane 只负责 `send`、`wait`、`capture`。
* lane 不保存 v1 `steps`。
* lane 不成为完整 Flow V2 block-tree。
* 并发后的多个 capture 结果通过 `merge_parallel_results` 机械合并。
* 后续 `parse` / `send_artifact` 显式引用合并 artifact。

v1 只保留为 legacy template 兼容层：旧模板继续可读、可执行、可导入，但新 Flow V2 主路径不再生成或保存 v1 control fields。
