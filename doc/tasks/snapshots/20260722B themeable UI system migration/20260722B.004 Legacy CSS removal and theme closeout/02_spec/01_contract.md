# Formal Contract

## Entry Preconditions

* `.001`已通过framework/settings/theme lifecycle Code/Test Gate。
* `.002`已通过App/Room/terminal migration、xterm retention和mixed-selector handoff Gate。
* `.003`已通过Macro/Library migration、legacy workbench deletion和replacement oracle Gate。
* 任一前置仍有未解决P1/P2时不得用`.004`掩盖或延期后宣称根任务完成。

## Final Source Contract

### CSS manifest

* `rg --files src -g '*.css'`最终只返回`src/app.css`。
* `src/styles.css`不存在，`src/styles/`目录不存在，production source没有相对import指向上述path。
* `src/**/*.svelte`不存在`<style>`或`<style ...>`；不得保留empty block。
* `src/app.css`是手写source contract；Vite/Tailwind build产物不计为repo source，但必须由clean build重建而不是check in旧generated CSS。

### `src/app.css` allowlist

* 允许Tailwind CSS import、daisyUI plugin/theme registration和Tailwind所需source/theme directives。
* 允许一个non-color terminal/font family token declaration。
* 允许xterm package-generated DOM的最小structural selectors，仅处理`.terminal-host > .xterm`、`.terminal-host .xterm-screen`和`.terminal-host .xterm-viewport`的position/inset/size/overflow integration。
* xterm bridge不得设置background/foreground/ANSI color；颜色只由`.002`JavaScript palette和daisy semantic terminal chrome提供。
* 禁止`@apply`、custom component layer、迁移前selector block、hard-coded color和与xterm generated DOM无关的project layout rule。

### Color residue

* production Svelte/TypeScript/CSS不得出现hex/rgb/hsl/oklch arbitrary UI color或Tailwind arbitrary color utility。
* 唯一例外为`.002`建立并在review登记的`src/lib/terminal/xtermTheme.ts`完整light/dark ANSI palette；该file只供xterm option使用。
* package code、lockfile、test fixture、docs和generated dist不纳入UI source color residue；scanner target必须显式，不能用宽泛exclude隐藏production file。

## Theme Matrix Contract

* canonical TypeScript catalog、browser settings strict guard、Settings options和daisyUI CSS registration必须精确一致：35个不重复explicit theme，加唯一`system`preference。
* 35个explicit theme分别在1600px、900px、720px运行programmatic layout/state smoke；`system`在两个emulated color scheme分别运行三viewport，共111个effective theme/viewport case。
* 每个case至少覆盖Home、Room topbar/Settings、terminal chrome、Macro panel、Library panel和notice的stable populated state。
* 每个case断言document无非预期horizontal overflow、critical control仍在所属panel、hidden/visible panel contract不变、native disabled/readonly/current state可区分、surface foreground/background不是transparent/固定legacy值。
* screenshot回归只选有代表性的theme/viewport/state组合，避免为全部111 cases制造脆弱pixel fixture；全矩阵仍必须以computed/geometry assertion实际遍历。
* explicit theme刷新后保留；`system`light/dark随media变化原位更新；invalid current value继续exact reset；Theme change无HTTP/WebSocket/Room mutation。

## UI Structure Closeout

* 消费从`20260722A.002`父revision生成并提交的32-file稳定per-file fingerprint fixture；fingerprint只排除class/style presentation，不允许用迁移后手写aggregate digest充当父版本oracle。
* 父基线835个non-presentation entry到current只允许App Theme field新增label/span/select/option四个element；其余file的element、顺序和所有非class/style attribute逐文件exact一致。
* Terminal测试状态不得写入production `data-terminal-instance-id`、palette、viewport、cursor或selection attribute；测试只能显式dispatch opt-in request event同步读取，正常runtime不复制selection到DOM。
* 不允许额外wrapper、control、topbar button、Home Settings、theme gallery、content reorder或test-id删除。
* 1600/900/720的panel placement、resizer、overflow/scroll owner、sticky/fixed feedback和compact density必须符合`.002`/`.003`baseline tolerance；640/680/760/980/1100/1260px精确边界保持父版本inclusive `max-width`语义。
* Theme migration不得改变任何runtime/store/server state；full current behavior journey是完成条件，不是可选visual smoke。

## Automated Residue Gate

* `justfile`新增`ui-style-residue`作为唯一项目命令入口，执行CSS manifest、legacy path/import、Svelte `<style>`、`@apply`/custom layer、hard-coded production color和catalog/config drift检查。
* residue logic放入可单测的project script或test，不依赖人工grep输出；任何violation输出具体file/line和reason并non-zero exit。
* existing `just check`纳入或调用该Gate，使后续change不能无声恢复legacy CSS；`just build`继续独立验证generated output。
* scanner允许existing semantic/test-hook class attribute，但必须证明没有custom selector rule owner；不得为了清class而破坏DOM/test contract。

## Current Test and Spec Closeout

* current tests不再引用deleted CSS path、旧rule count/hash、旧repeated cascade或旧computed fixed color；用`.003`replacement oracle和本任务matrix覆盖。
* historical snapshot、historical E2E和task evidence不修改、不纳入current execution入口。
* 新增`doc/tasks/active_specs/ui_theme_contract.md`并更新`000_readme.md`。
* 同步`user_data_storage_contract.md`中的browser settings v3/Theme、`shell_deck_architecture.md`中的browser-local presentation、`room_terminal_contract.md`中的xterm theme retention，以及Macro/Library active specs中的structure/density/theme state真值。
* 只在全部Code/Test Gate真实完成后，将root/child task index与review状态标记完成。

## Negative Boundary

* 不新增theme、custom palette、account sync、server persistence、Room preference或UI入口。
* 不利用closeout改变UI结构、breakpoint、product copy、keyboard flow或business behavior。
* 不删除失败test、放宽关键assertion、扩大scanner exclude或保留compatibility rule来换取green Gate。
* 不修改`.001`至`.003`scope之外的backend/runtime code；发现独立bug另建任务。

## Completion Gate

* Source：`just ui-style-residue`通过，最终CSS manifest/allowlist/color allowlist完全符合contract。
* Theme：111-case programmatic matrix、representative visual assertions、persistence/system/invalid/no-transport测试通过。
* Structure：稳定父版本per-file fixture只产生唯一Theme field四element增量，三viewport geometry、六个exact inclusive breakpoint和all critical states通过。
* Terminal：explicit/system换肤保留同一xterm identity、scrollback viewport、bottom follow、resize、selection和continued PTY output。
* Regression：`just check`、`just build`、full current unit、integration、E2E与`git diff --check`全部通过。
* Document：active specs、root/child index和implementation review记录真实command/result/P1/P2/P3；未解决P1/P2为零。
