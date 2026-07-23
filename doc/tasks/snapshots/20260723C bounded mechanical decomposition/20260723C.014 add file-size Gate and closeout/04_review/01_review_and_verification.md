# Review and Verification

## 总体判断

本轮新增247行`checkFileSize.ts`与171行focused unit，没有修改production。scanner从repo root自动发现project-authored regular code source，按repo-relative POSIX path确定性排序；root config/entry、JS/TS variants、Svelte、CSS/HTML、native C/C++、shell/Nix等显式source type均受控。400 logical lines合法、401失败；CRLF与trailing newline精确计数。invalid UTF-8、unreadable、symlink、non-regular entry和enumeration failure全部返回稳定diagnostic。

`.013`已删除退役raw historical journey及hash-only oracle，scanner没有path/digest special case。当前扫描332个文件：root 7、server 52、src 124、scripts 14、tests 135；全仓最大文件为398行`macroRecordSession.svelte.ts`。最终未发现未解决P1/P2。

## Gate ownership

* `just file-size`只调用`scripts/checkFileSize.ts`。
* `just check`依次包含file-size、UI style residue、TypeScript与Svelte Gate。
* public unit core显式发现`fileSizeGate014.test.ts`。
* scanner与unit都被scanner自身自动发现，没有scanner source allowlist。
* VCS/dependency/runtime cache/build output通过明确non-project directory classification排除；authored source不存在path、digest、glob、fixture、generated或historical例外。

## Findings and Solutions

### Finding 1：localeCompare不能作为跨运行机的稳定path order

* 级别：P2 / L1。
* 问题：初版对candidate、directory entry和diagnostic使用`localeCompare`，排序可能受ICU locale影响，不符合repo-relative POSIX path的确定性要求。
* 处理：改为明确的code-point comparator；所有candidate、directory entry与issue复用同一比较规则。
* 状态：已修复。

### Finding 2：第一版scanner范围不能代表“全项目code”

* 级别：P2 / L1。
* 问题：第一版只扫描`server/src/scripts/tests`的`.ts/.svelte`，会漏掉root config、`.js/.tsx/.mjs`、`src/app.css`与`server/ptyHelper.c`；同时保留1041行historical path/digest例外。
* 处理：`.013`删除退役source/hash oracle；scanner改为repo-root source-type discovery并新增root/JS/TSX/MJS/CSS/C unit，当前332个authored source统一零例外。
* 状态：已修复。

### Finding 3：Gate wiring需要可回归的source oracle

* 级别：P2 / L1。
* 问题：只修改justfile可以让当前执行通过，但未来误删`file-size` dependency或public unit discovery时没有focused test直接解释。
* 处理：unit冻结`just check`完整依赖顺序、唯一scanner recipe、public unit path、代表性code type与non-project directory classification。
* 状态：已修复。

## Gate 结论

Close Gate通过。

* File-size Gate：通过，332个project-authored code source受控，最大398行，exceptions=0。
* Static Gate：通过；UI residue clean，TypeScript与Svelte为0 error、0 warning。
* Build Gate：通过，227 modules transformed。
* Full Unit Gate：通过；Theme 6、unit core 236、integration 53，合计295项。
* Independent Integration Gate：通过，53项。
* Full E2E Gate：通过，67项，固定`--workers=1`，3.5分钟。
* Child Focused Gate：原closeout已逐项覆盖`.001-.014`；本次受影响的`.007/.011/.013/.014`再次串行通过。
* Evidence Gate：current/structured historical inventory、structure/style、ownership/import boundary与case hash全部通过；退役raw journey不存在，没有skip/only/fixme/fail。
* Diff/Change Gate：通过；无conflict marker、无未归属production变化，root与全部child `conflict=false`。

## 需要人工拍板

无。

## 未覆盖与残余风险

无已知阻断项。未来新增或增长的project-authored code会由默认`just check`自动进入Gate；如果出现新的code extension，应把它加入显式source-type catalog及对应unit，而不是增加path例外。
