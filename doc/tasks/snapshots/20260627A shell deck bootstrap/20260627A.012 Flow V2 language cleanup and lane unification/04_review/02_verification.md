# Verification

状态：pass。

已运行命令：

```bash
bun test tests/unit/flowV2Schema.test.ts
just check
just test-012
just test-unit
just test-e2e
git diff --check
```

当前结果：

* `bun test tests/unit/flowV2Schema.test.ts`: 15 pass。
* `just check`: 0 errors / 0 warnings。
* `just test-012`: 15 pass。
* `just test-unit`: 123 pass。
* `just test-e2e`: 15 pass, 1 Codex online-only skipped。
* `git diff --check`: pass。

覆盖点：

* Flow V2 validator 接受合法 nested `for -> if/elif/else -> return/continue`。
* Flow V2 validator 拒绝 legacy flow node、字符串表达式、字符串 boolean、loop 外的 break/continue、非法 sleep mode、重复 node id。
* Flow V2 validator 递归拒绝旧控制字段，覆盖 `range.goto`、`capture.next`、`parser.next`、`parser.rules[].goto`、`join.next`。
* `parse` 必须显式引用 `visible predecessor scope` 中的前序 artifact-producing step。
* `parallel_all.lanes[*]` 接受受限 send/wait/capture schema。
* `parallel_all.lanes[*]` 拒绝 v1 lane `steps`、Flow V2 lane `body`、lane-local user-driven workflow 字段。
* `merge_parallel_results` 必须显式引用 `visible predecessor scope` 中的前序 `parallel_all`。
* `send_artifact` 必须显式引用 `visible predecessor scope` 中的前序 artifact-producing step。
* branch 内可以引用外层已存在的 visible predecessor artifact。
* branch 内产出的 artifact 不会泄漏到 later sibling。
* 没有 `indexMap` 时，同 kind/value 的重复 lane terminal 仍会失败。
