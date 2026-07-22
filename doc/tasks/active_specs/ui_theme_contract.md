# UI Theme Contract

## Framework 与 source ownership

current UI只使用Tailwind CSS 4.3.3与daisyUI 5.7.0；Svelte 5继续拥有DOM、interaction与runtime state。`src/app.css`是`src`内唯一project-authored CSS source，只包含Tailwind layer/import、daisyUI component/theme registration、terminal font token和xterm generated DOM的最小structural bridge。production另外直接加载`@xterm/xterm/css/xterm.css`，它是package-owned vendor CSS，不复制到project source。

project Svelte component不含`<style>` block。可写在existing element上的layout、responsive、density和state presentation全部使用static Tailwind utility与daisyUI semantic component class；不得用`@apply`、custom component layer、legacy selector或hard-coded UI color重建第二套stylesheet。唯一hard-coded color allowlist是`src/lib/terminal/xtermTheme.ts`中完整的light/dark ANSI palette。

`just ui-style-residue`检查唯一CSS manifest、旧path/import、Svelte `<style>`、`app.css` allowlist、production fixed color以及Theme catalog drift；`just check`包含该Gate。

## Theme preference

canonical preference是`system`加35个daisyUI explicit theme：`light`、`dark`、`cupcake`、`bumblebee`、`emerald`、`corporate`、`synthwave`、`retro`、`cyberpunk`、`valentine`、`halloween`、`garden`、`forest`、`aqua`、`lofi`、`pastel`、`fantasy`、`wireframe`、`black`、`luxury`、`dracula`、`cmyk`、`autumn`、`business`、`acid`、`lemonade`、`night`、`coffee`、`winter`、`dim`、`nord`、`sunset`、`caramellatte`、`abyss`、`silk`。TypeScript catalog、strict browser settings guard、Settings options和CSS registration必须exact一致、无重复。

Theme是browser-local presentation preference，写入唯一browser settings v3 value。Vite从canonical catalog、default与同一exact settings validator生成parser-blocking head bootstrap，并在任何stylesheet/application module前应用initial Theme；`main.ts`在Svelte mount前重读复核。explicit theme刷新保留且不随OS变化，`system`不写`data-theme`并实时跟随`prefers-color-scheme`。invalid current v3 value按exact-schema contract整体reset，不读、不迁移v2。Theme change不发送HTTP/WebSocket mutation，不要求Room controller，也不进入Room、terminal、Macro或Library saved state。

唯一Theme入口位于Room既有Settings popover。Home没有Settings，topbar没有独立Theme button；同一browser设置仍覆盖Home、Room、terminal chrome、Macro、Library与notice。

## Frozen UI 与 terminal bridge

除Settings中一个紧凑Theme select外，Home、App、Workspace、terminal、Macro和Library的DOM hierarchy、control inventory/order、panel位置、resizer、overflow/scroll owner及1600/900/720 responsive contract不变；父版本640/680/760/980/1100/1260px `max-width`边界均保持inclusive。presentation使用semantic base/content/primary/success/warning/error token；disabled、readonly、active/current-run state在所有theme中必须保持可区分。

Structure Gate消费由`20260722A.002`父revision生成的32-file稳定per-file fixture：父基线835个non-presentation entry，current只允许App Theme field新增label/span/select/option四个element，其余file逐项exact一致。fingerprint只排除class/style presentation；terminal identity、palette、viewport、cursor与selection测试状态不得写入production `data-terminal-*` attribute，而由测试显式dispatch opt-in request event同步读取。

xterm theme只根据current effective light/dark appearance选择ANSI palette，并原位更新既有`xterm.options.theme`。explicit/system换肤不得dispose/recreate instance，不得清空buffer或改变scrollback viewport、selection、cursor、fit/parser和continued PTY output。xterm runtime subtree的position/size/overflow是`app.css`唯一允许的project selector bridge。

## Current Gate

全theme Gate遍历35个explicit theme × 1600/900/720，以及`system` light/dark × 同三viewport，共111个case；每个case覆盖populated Home、Room Settings、terminal chrome、Macro、Library和notice，并断言overflow、critical owner、panel visibility、disabled/readonly/current state与semantic surface。focused browser journeys另覆盖first paint、持久化、invalid reset、无transport、xterm retention，以及640/680/760/980/1100/1260px exact inclusive boundary；full current unit/integration/E2E仍是closeout条件。
