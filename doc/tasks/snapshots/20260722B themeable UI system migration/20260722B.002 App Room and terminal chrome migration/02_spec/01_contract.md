# Formal Contract

## Added Semantics

### Surface migration

* 下列existing element改用daisyUI semantic component class与Tailwind static utility表达presentation：Home、room shell、topbar、controller status、Settings、notice、workspace outer shell、side panel、resize handle、tab strip/tab、terminal pane/meta/host、Text editor/gutter和empty room。
* semantic state统一映射到theme token：controller/success、observer/reconnecting/neutral、take-control/warning、error、active tab、hover/focus、disabled/aria-disabled/shared-read-only。
* current compact geometry是显式contract，不使用daisyUI default size替代：topbar和button heights、tab尺寸、terminal metadata、stage padding、side-panel width与resize handle hit area保持baseline。
* Home虽无Theme selector，也必须消费root effective theme；Home DOM和Room create/open/destroy flow不变。

### xterm theme bridge

* 唯一module `src/lib/terminal/xtermTheme.ts`拥有`light`与`dark`两份完整xterm `ITheme` palette，至少覆盖background、foreground、cursor、selectionBackground及ANSI normal/bright colors。
* effective theme明暗由`.001`canonical theme metadata/system resolver决定，`TerminalSlot`不维护第二份theme id catalog，也不从class name猜测。
* `TerminalSlot`接收或订阅只读effective appearance，在existing xterm instance上赋值`options.theme`；首次创建和后续切换使用同一palette resolver。
* Theme update不得调用`dispose()`、`reset()`、`clear()`、`write()`、`scrollToBottom()`或重新执行terminal open/fit lifecycle。
* Theme update前后active buffer的`baseY`、`viewportY`、cursor、selection和terminal object identity保持；后续PTY output继续写入同一parser/write pump。
* xterm vendor stylesheet import继续保留，不复制到project CSS，不用`!important`硬编码固定terminal background抵消theme。

### Legacy selector ownership

* 实施前生成`base.css`、`room.css`、`terminal.css`、`workspace-panels.css` selector → live component consumer inventory。
* 本change删除所有只由本任务surface消费的旧selector，并删除因此变空的import/file。
* 若混合文件仍有Macro/Library live consumer，review必须逐项列出remaining selector、consumer和`.003`归属；不得留下无consumer rule、颜色override或本任务surface的双owner。
* 新framework entry的global bridge只可承载xterm vendor integration、root full-height/font等确实跨component的最小rule，并逐条记录理由；其余geometry在existing markup上表达。

## Frozen UI Structure

* `App.svelte`、本任务六个component的element tag、nesting、sibling order、role、aria、test id和event handler保持，`.001`Theme field除外。
* 不新增container/wrapper，不用daisyUI drawer/navbar/tabs markup替换现有element tree；只在原element修改static class或必要style variable。
* Settings、notice、tab、Room row、Text gutter和terminal metadata的content/order不变。
* topbar在current breakpoint的wrap行为、Workspace横向side-panel关系、720px窄屏behavior和resizer位置保持。父CSS的`max-width`语义严格inclusive：640、680、980、1100与1260px本身进入对应窄侧规则；source使用显式inclusive media variant，不使用只覆盖`< N`的`max-[Npx]`。
* inline dynamic width和line-number transform属于runtime geometry，可继续使用style property/CSS variable；不得把它们误改为动态Tailwind class。
* terminal retention测试状态不写入persistent production DOM attribute。测试只有主动向host dispatch `shell-deck-terminal-test-state-request`并提供callback时，才同步取得instance/color-scheme/buffer/cursor/selection snapshot；未请求时不复制selection或维护view-state instrumentation。

## Frozen Product Semantics

* Home list refresh/create/destroy/open、Room control takeover和Settings save/dismiss行为不变。
* terminal create/close/select/drag、active tab、shared readonly、resize、Text edit/copy/line synchronization不变。
* real PTY input/output、parser pump、room replay、view-state保存和live-output scroll retention不变。
* NoticeStack显示、dismiss、repeat/audio metadata行为不变；本任务只迁移visual state。
* Theme不进入server/Room/terminal messages，不改变controller permission。

## Primary Files

* `src/App.svelte`。
* `src/lib/components/RoomHome.svelte`、`TerminalSlot.svelte`、`TextBoxSlot.svelte`。
* `src/lib/components/workspace/WorkspaceShell.svelte`、`TerminalTabBar.svelte`、`NoticeStack.svelte`。
* `src/lib/terminal/xtermTheme.ts`、framework CSS entry，以及`base.css`、`room.css`、`terminal.css`、`workspace-panels.css`中对应live selectors/import。
* relevant current UI inventory、geometry、terminal view-state/live replay和browser E2E tests。

## Negative Boundary

* 不修改Macro/Library component内部markup/class，除非是由WorkspaceShell传递的existing outer panel boundary且formal review逐项登记。
* 不修改backend/server/tests fixture业务数据，不改变WebSocket timing或为视觉测试增加production delay。
* 不加入per-theme terminal palette、user palette persistence或自动contrast调色器。
* 不为迁移便利删减test id、aria state、metadata或readonly feedback。

## Gate

* Structure：迁移前后DOM fingerprint只允许class和`.001`Theme field差异；listed component tag/nesting/control/test-id inventory一致。
* Geometry：1600px、900px、720px覆盖Home empty/populated、empty Room、多terminal tabs、Macro/Library side panels visible/hidden、Settings和notice；关键bounding box与overflow owner满足baseline tolerance。另对640/680/980/1100/1260精确宽度及必要的`N+1`断言inclusive边界与宽侧切换。
* Theme：至少以light、dark和三种不同风格built-in theme验证本任务所有surface使用semantic token，不残留固定light chrome；`.004`再执行35-theme全矩阵。
* Terminal：在非bottom scrollback状态切换explicit/system theme，通过opt-in test bridge断言xterm identity、baseY、viewportY、selection/continued output保持；production host不存在为该断言新增的7个`data-terminal-*`状态attribute，bottom-follow和resize仍通过`20260722A.002`journey。
* Behavior：current comprehensive UI、Room controller/observer、Text slot和real PTY focused journeys通过且无新增server mutation。
* Residue：无本任务surface旧selector双owner；remaining mixed-file selector manifest只指向`.003`live consumer。
* Quality：`just check`、`just build`、focused unit/E2E、relevant current E2E和`git diff --check`通过。
