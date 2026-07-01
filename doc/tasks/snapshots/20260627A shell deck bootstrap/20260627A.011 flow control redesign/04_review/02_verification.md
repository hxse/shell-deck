# Verification

状态：pass。

已运行命令：

```bash
bun test tests/unit/flowV2Schema.test.ts
just check
just test-011
just test-unit
just test-e2e
git diff --check
```

结果：

* `bun test tests/unit/flowV2Schema.test.ts`: 10 pass。
* `just check`: 0 errors / 0 warnings。
* `just test-011`: Flow V2 unit 10 pass + macroTemplateWorkbench e2e 1 pass。
* `just test-unit`: 118 pass。
* `just test-e2e`: 15 pass, 1 online-only skipped。
* `git diff --check`: pass。

覆盖点：

* Flow V2 validator 接受合法 nested `for -> if/elif/else -> return/continue`。
* Flow V2 validator 拒绝 legacy flow node、字符串表达式、字符串 boolean、loop 外的 break/continue、非法 sleep mode、重复 node id、parse 引用后置 capture-source、v1 控制字段、坏的 parallel_all lane。
* GUI e2e 验证 Actions / Flow palette 分栏、Flow V2 按钮计划态、Legacy flow nodes 折叠区、legacy badge、原 v1 模板 CRUD/import/export/delete confirm 仍可用。

残余范围：

* Flow V2 compiler/interpreter 未实现。
* Flow V2 block-tree editor/inspector 未实现。
* 默认新建模板仍为 v1，以免在 runner 不支持 v2 时创建不可执行模板。
