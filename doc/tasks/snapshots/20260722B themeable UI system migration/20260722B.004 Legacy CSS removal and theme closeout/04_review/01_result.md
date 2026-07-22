# Review Result

## 结论

`20260722B.004`的Formal Document、Code、Test与Document Gate均完成。production source已收敛为唯一`src/app.css`，legacy CSS path/import与Svelte `<style>`为零；35个explicit theme和`system`明暗在三viewport形成的111-case matrix、full current regression及active spec同步均通过。

## Implementation Result

* CSS source：`src/framework.css`重命名为`src/app.css`，删除`src/styles.css`与空`src/styles/`目录；`src/main.ts`只加载`./app.css`，`TerminalSlot.svelte`只额外加载xterm vendor CSS。
* Final allowlist：`app.css`只保留Tailwind layer/import、daisyUI plugin与35 theme注册、一个terminal font family token，以及xterm runtime subtree的position/inset/size/overflow bridge；body既有margin/font/background改为`index.html`上的static semantic utility。
* Repeatable Gate：新增`checkUiStyleResidue.ts`，检查exact CSS manifest、legacy path、Svelte style block、CSS import allowlist、custom block/layer/`@apply`、production fixed color、xterm structural property和Theme catalog drift；violation带file/line/reason并non-zero exit。`just ui-style-residue`已接入`just check`。
* Test oracle：current tests不再读取deleted CSS或冻结旧cascade；新增CSS Gate负例、36-preference catalog一致性、`20260722A.002`稳定per-file fixture与Theme四element exact delta，以及111-case Home/Room/terminal/Macro/Library/Settings/notice computed/geometry matrix。
* Spec closeout：新增`active_specs/ui_theme_contract.md`，同步readme、browser settings/storage、architecture、Room/terminal、Macro与Library current truth。

## 自审与直接修复

* P1：0 unresolved。
* P2：0 unresolved。除首轮AgentEvent checkbox与scanner问题外，closeout复核发现原structure test仅冻结迁移后digest，且terminal额外暴露七个测试attribute；现已改为父版本32-file fixture与唯一Theme四element allowlist，并用opt-in event bridge读取terminal测试状态。first-paint与六个responsive边界分别回到`.001`、`.002`、`.003`owner修复并补测。
* P3：0 unresolved。已将160k retained-history journey的测试级总预算调整为40秒、marker wait调整为30秒；160k fixture、parser-idle、retained identity和parser-work assertion未降低。takeover helper会先关闭前序journey故意留下的insertion palette，避免测试setup被scrim阻断；未修改产品行为。
* 需要用户拍板：无。

## Boundary Review

* production改动只涉及CSS entry、static presentation class和AgentEvent control尺寸；没有修改server、protocol、Room state、Macro/Library schema或runtime owner。
* `20260722A.002`fixture冻结32个Svelte file与835个non-presentation DOM entry；current逐文件对照为839个，唯一delta是App Theme field的label/span/select/option。Theme仍只有Room Settings内唯一selector，没有新增topbar/Home入口、wrapper或control。
* 父版本640/680/760/980/1100/1260px `max-width`均保持inclusive；terminal测试状态不再进入production `data-terminal-*` attribute或复制selection，而由opt-in event bridge按需读取。
* xterm vendor CSS和`xtermTheme.ts`ANSI palette保持明确例外；Theme切换继续复用existing terminal instance，不把颜色重新引入project CSS。
* historical task snapshot未改；current test调整只关闭已登记的执行预算与setup隔离问题，没有删除test或放宽关键oracle。

## Gate Evidence

* `just ui-style-residue`：通过；`src/app.css`为唯一project CSS source，35个theme注册一致。
* `just test-20260722b-004`：36/36 focused unit（747 expects）与7/7 Chromium E2E通过；其中matrix精确遍历111个不重复theme/viewport case，并覆盖first-paint与六个exact inclusive breakpoint。
* `just check`：TypeScript与Svelte均0 error、0 warning；residue Gate同步通过。
* `just build`：208 modules，production CSS 134.90 kB（gzip 21.56 kB），clean production build通过；generated HTML中的同步Theme bootstrap早于entry module与stylesheet。
* `just test-unit`：6/6 theme foundation、189/189 core unit、53/53 integration全部通过。
* `just test-e2e`：62/62 full current Chromium journey通过。
* `just diff-check`：通过；未解决P1/P2为零。
