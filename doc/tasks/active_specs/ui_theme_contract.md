# UI Theme Contract

## Framework 与 source ownership

current UI只使用Tailwind CSS 4.3.3与daisyUI 5.7.0；Svelte 5继续拥有DOM、interaction与runtime state。`src/app.css`是`src`内唯一project-authored CSS source，只包含Tailwind layer/import、daisyUI component/theme registration、terminal font token和xterm generated DOM的最小structural bridge。production另外直接加载`@xterm/xterm/css/xterm.css`，它是package-owned vendor CSS，不复制到project source。

project Svelte component不含`<style>` block。可写在existing element上的layout、responsive、density和state presentation全部使用static Tailwind utility与daisyUI semantic component class；不得用`@apply`、custom component layer、legacy selector或hard-coded UI color重建第二套stylesheet。唯一hard-coded color allowlist是`src/lib/terminal/xtermTheme.ts`中完整的light/dark ANSI palette。

`just ui-style-residue`检查唯一CSS manifest、旧path/import、Svelte `<style>`、`app.css` allowlist、production fixed color、Theme catalog drift，以及interactive control是否直接声明daisyUI component、普通form control是否精确使用统一theme-derived fill与`box-border`且没有退回structural border/outline；`just check`包含该Gate。实现上`checkUiStyleResidue.ts`只保留source manifest编排、稳定public re-export与CLI，Svelte AST semantics、Macro presentation policy、app.css/theme ownership及shared issue/helper分别由`uiStyleResidue/`下独立模块拥有；test import与just命令继续以原facade为唯一入口。

## Theme preference

canonical preference是`system`加35个daisyUI explicit theme：`light`、`dark`、`cupcake`、`bumblebee`、`emerald`、`corporate`、`synthwave`、`retro`、`cyberpunk`、`valentine`、`halloween`、`garden`、`forest`、`aqua`、`lofi`、`pastel`、`fantasy`、`wireframe`、`black`、`luxury`、`dracula`、`cmyk`、`autumn`、`business`、`acid`、`lemonade`、`night`、`coffee`、`winter`、`dim`、`nord`、`sunset`、`caramellatte`、`abyss`、`silk`。TypeScript catalog、strict browser settings guard、Settings options和CSS registration必须exact一致、无重复。

Theme是browser-local presentation preference，写入唯一browser settings v3 value。fresh/missing setting与invalid current v3整体reset的默认Theme都是`business`；已有合法v3 value逐值保留，包括`system`及其余explicit theme，不做强制改写。Vite从canonical catalog、default与同一exact settings validator生成parser-blocking head bootstrap，并在任何stylesheet/application module前应用initial Theme；`main.ts`在Svelte mount前重读复核。explicit theme刷新保留且不随OS变化，`system`不写`data-theme`并实时跟随`prefers-color-scheme`。v2及更早key仍不读、不删、不迁移。Theme change不发送HTTP/WebSocket mutation，不要求Room controller，也不进入Room、terminal、Macro或Library saved state。

唯一Theme入口位于Room既有Settings popover。Home没有Settings，topbar没有独立Theme button；同一browser设置仍覆盖Home、Room、terminal chrome、Macro、Library与notice。

## Native daisyUI control semantics

canonical dark theme精确为`dark`、`synthwave`、`halloween`、`forest`、`aqua`、`black`、`luxury`、`dracula`、`business`、`night`、`coffee`、`dim`、`sunset`、`abyss`，只由TypeScript effective appearance与xterm palette选择消费。应用不为explicit/system dark增加CSS theme owner；35个built-in theme自己的`base-*`、`--depth`、`--noise`、radius和border token原样生效。

button直接使用`btn`或`tab`。enabled command不使用与`business` base surface融在一起的默认`btn`或`btn-soft`：create/edit/prepare/validate/insert等普通命令使用solid `btn-primary`，panel/setting toggle及跨Macro/Library transfer使用solid `btn-secondary`，save/start使用solid `btn-success`，takeover/pause/repair使用solid `btn-warning`，remove/delete/destroy/stop使用solid `btn-error`；只有Home、close、cancel、copy、reset、refresh、help、node collapse/move与tab close等tertiary chrome使用`btn-ghost`。production不使用`btn-outline`、component-specific button surface规则或control-level `border-base-300`。text/number input、select与普通textarea直接使用对应daisyUI component的ghost variant、`box-border`与统一`bg-base-content/15` fill；该theme token在dark surface上形成浅色叠层、在light surface上形成深色叠层，不枚举Theme，也不使用彼此过近的`base-100/200/300`相邻shade。因为项目不加载Tailwind preflight，`box-border`必须直接挂在form element上，不能由Macro ancestor模拟。checkbox/range直接使用其framework component。keyboard focus继续由daisyUI outline拥有。

saved Macro的正常visual view不降低正文、step card或field文字的opacity/contrast；Edit与view内容保持同一可读presentation，由existing `macro-editor-lock-notice`以daisyUI `alert-info alert-soft`明确标记`Read-only`。仅`content_edit_lease_required` notice具有button role、pointer/focus affordance：click、Enter或Space都委托canonical `beginEdit()`，先获取fresh content lease，成功后才进入Edit；notice以外的editor surface不触发Edit。controller/lease-lost/pending异常使用solid `alert-warning`，active run使用solid `alert-error`，均保持不可激活的status；其余mutation guard、content lease和Edit/Save行为不变。

`border-base-300`只服务真实结构边界，例如app/pane outer boundary、sticky header、line-number gutter、floating popover、editor region和log/validation divider。普通toolbar、palette group、status block、record card及interactive control使用daisyUI background、card shadow、badge与active state区分；MacroPanel不得用ancestor selector手工模拟后代input/select/textarea/button。每个flow node在existing article的Tailwind `::after`上使用2px horizontal gradient separator，并与纵向`border-l-4`共享当前depth的`primary/secondary/accent/info` semantic token；它渐隐到transparent，不增加DOM、fixed color或stylesheet selector。透明dismiss layer、resize handle和复合editor inner textarea是明确的`border-0`例外。

## Frozen UI 与 terminal bridge

除Settings中一个紧凑Theme select外，Home、App、Workspace、terminal、Macro和Library的DOM hierarchy、control inventory/order、panel位置、resizer、overflow/scroll owner及1600/900/720 responsive contract不变；父版本640/680/760/980/1100/1260px `max-width`边界均保持inclusive。presentation使用semantic base/content/primary/success/warning/error token；disabled、readonly、active/current-run state在所有theme中必须保持可区分。

Structure Gate消费由`20260722A.002`父revision生成的32-file稳定per-file fixture：父基线835个non-presentation entry，current只新增App Theme field的label/span/select/option四个element；`20260723A`另明确授权两条attribute-level interaction delta——`MacroEditorShell`既有notice的conditional role/tabindex/click/keydown与`MacroPanel`到canonical `beginEdit()`的prop wiring。`20260723C.012`只把`MacroFlowNodeList`既有palette binding从local identifier改接唯一insertion controller，element count仍为22，并冻结current per-file digest `504a2ebf4fb51fb4ee0696c0fec78f2910ac9db12ee93b266e8ae2ee503935b2`与exact binding entry；全局element总数仍精确为839。fixture为这些文件保留父版本per-entry truth，测试断言精确removed digest与added entry，不靠替换current aggregate hash放行。fingerprint只排除class/style presentation；terminal identity、palette、viewport、cursor与selection测试状态不得写入production `data-terminal-*` attribute，而由测试显式dispatch opt-in request event同步读取。

xterm theme只根据current effective light/dark appearance选择ANSI palette，并原位更新既有`xterm.options.theme`。explicit/system换肤不得dispose/recreate instance，不得清空buffer或改变scrollback viewport、selection、cursor、fit/parser和continued PTY output。xterm runtime subtree的position/size/overflow是`app.css`唯一允许的project selector bridge。

## Current Gate

全theme Gate遍历35个explicit theme × 1600/900/720，以及`system` light/dark × 同三viewport，共111个case；每个case覆盖populated Home、Room Settings、terminal chrome、Macro、Library和notice，并断言overflow、critical owner、panel visibility、disabled/readonly/current state与semantic surface。focused browser journeys另覆盖`business` first paint、已有合法setting保留、business/night/light下Settings/Library/Macro control的native component、统一field fill、transparent structural border与可见keyboard focus；`business`直接验证enabled command的solid semantic variant、rendered color与base surface距离、content contrast及tertiary ghost allowlist，验证代表性input/select的实际叠层alpha、与`base-100/base-200`的rendered RGB距离及content contrast，并比较Macro Save前后正文/field computed color与opacity exact一致、normal read-only notice为soft info且click/keyboard均取得lease进入Edit、active-run notice点击无动作、depth 0/1 flow separator实际渲染为不同semantic linear gradient。`controlInventory.ts`保持稳定re-export facade，historical/current/evidence truth分模块且每个mutable source不超过400行；inventory test冻结全部runtime export name/value/order digest与historical raw-byte hash。invalid reset、无transport、xterm retention，以及640/680/760/980/1100/1260px exact inclusive boundary继续覆盖；full current unit/integration/E2E仍是closeout条件。
