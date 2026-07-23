# Formal Contract

## 任务边界

`.014`只增加静态Gate、验收test/recipe、active spec和review/index closeout。它不承接`.001-.013`的production/test拆分实现。

## 任务规范

### 行数定义

* 上限为400 logical lines，400合法、401失败。
* scanner以UTF-8读取regular file，`\n`和`\r\n`各计一个line break；末尾换行不产生额外空逻辑行。
* 文件按repo-relative POSIX path排序，diagnostic稳定包含path、actual与limit。
* unreadable、invalid UTF-8、symlink或枚举失败必须fail loudly，不能跳过。

### 扫描与零豁免

* 从repo root递归扫描project-authored code type，新文件自动进入；必须覆盖root config、`.js/.jsx/.mjs/.cjs`、`.ts/.tsx/.mts/.cts`、`.svelte`、`.css`、`.html`、native C/C++、shell/Nix及当前声明的其他source extension。
* extensionless build entry与JSON config使用明确project-code filename集合；普通docs/data不作为code扫描。
* VCS metadata、dependency、runtime cache与build/test output按明确non-project directory集合跳过；这不是authored-source allowlist。
* 不存在path、digest、glob、directory、fixture、generated名称或historical名称级authored-source豁免。
* scanner源码、scanner unit和所有新增module自身也受400行限制。

### Gate入口

* 新增`just file-size`，调用唯一scanner。
* `just check`必须包含`file-size`，并继续包含style/TypeScript/Svelte原步骤。
* scanner有focused unit覆盖400/401、CRLF、trailing newline、root/nested discovery、JS/CSS/C source、ignored non-project tree、invalid UTF-8、symlink与enumeration failure。

### Root closeout

* `.001-.013`全部Code/Test Gate完成且review无P1/P2。
* active specs只写最终ownership与Gate，不写历史过程。
* root与十五个change全部`conflict=false`；没有conflict marker或未归属代码。

## 示例

正例：新建`src/lib/example.ts` 401行，即使未列在manifest，默认`just check`也报告`example.ts:401:400`并失败。

正例：新建root `tool.mjs`、`src/example.tsx`、`src/panel.css`或`server/helper.c` 401行，均由默认Gate报告并失败。

反例：为未来可能的大fixture豁免`tests/fixtures/**`，或只扫描当前已知大文件清单，均不合格。

## 测试

Close Gate固定运行：

* `just file-size`
* `just check`
* `just build`
* `just test-unit`
* `just test-integration`
* `just test-e2e`
* `just diff-check`

另需运行受本轮修正影响的child focused recipe、current/structured historical inventory、structure/style oracle和`jj log/status/diff`审计。任何warning、skip/only、test evidence下降、oversized source或conflict阻断完成。本轮未执行这些Code/Test Gate。
