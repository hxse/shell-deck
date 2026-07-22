# Formal Contract

## Added Semantics

### Framework pipeline

* `package.json`加入Tailwind CSS 4、`@tailwindcss/vite`和daisyUI 5，并由current lockfile固定实际版本；不增加另一套UI framework。
* `vite.config.ts`接入official Tailwind Vite plugin，保留existing room route bridge、Svelte plugin、dev proxy和manual chunks行为。
* 新framework entry CSS注册Tailwind与daisyUI，配置`light --default`、`dark --prefersdark`及其余33个内置theme。
* 分阶段期间`src/styles.css`仍可作为legacy entry被import；framework和legacy import次序必须唯一、显式且有测试/构建验证，不为同一新Theme control建立双重custom style owner。

### Theme catalog

* Theme preference type严格等于`system`加35个built-in id：
  `light`、`dark`、`cupcake`、`bumblebee`、`emerald`、`corporate`、`synthwave`、`retro`、`cyberpunk`、`valentine`、`halloween`、`garden`、`forest`、`aqua`、`lofi`、`pastel`、`fantasy`、`wireframe`、`black`、`luxury`、`dracula`、`cmyk`、`autumn`、`business`、`acid`、`lemonade`、`night`、`coffee`、`winter`、`dim`、`nord`、`sunset`、`caramellatte`、`abyss`、`silk`。
* 一个轻量theme module拥有catalog、type guard和document application；App不得复制另一份选项数组，CSS config与TypeScript catalog必须由test验证一致。
* label可由theme id稳定格式化，不建立可漂移的第二套业务identity或alias。

### Browser settings v3

* `BROWSER_SETTINGS_KEY`直接变为`shell-deck:settings:v3`，`schemaVersion`直接变为literal `3`。
* `BrowserSettings` exact top-level keys在现有字段上新增required `theme`，值必须通过Theme preference strict guard；default为`system`。
* loader只读取v3 key。存在的v2 key既不读取、不删除，也不转换；v3 key缺失返回新default且`reset: false`。
* v3 key内若是v2 shape、missing/extra key、非catalog theme或非法JSON，返回structured-cloned v3 default且`reset: true`。
* saver拒绝所有非exact v3 settings，不补field，不清理extra key。

### Document application

* `index.html`的head在任何stylesheet与application module之前保留唯一同步bootstrap位置；Vite transform使用canonical Theme catalog、browser settings default与同一exact validator生成parser-blocking inline script，不复制第二份35项catalog。
* head bootstrap同步读取current v3 value；只有完整exact settings合法时才应用其Theme，缺失或任意非法shape均使用`system` default。它必须同时设置explicit `data-theme`与effective `data-theme-color-scheme`，保证首帧已经是正确Theme。
* `src/main.ts`仍在`mount(App, ...)`前同步重读settings并应用Theme，把document接回runtime lifecycle；不能依赖`onMount`或异步task完成首屏切换。
* 显式theme在root document设置对应`data-theme`；切回`system`移除显式override，让configured default/prefers-dark contract生效。
* Theme application同步维护可供xterm bridge消费的effective light/dark signal，但本子任务不迁移或重建xterm。
* `system`只在该mode下响应`matchMedia('(prefers-color-scheme: dark)')`变化；切到显式theme停止其视觉影响，owner dispose清理listener。
* Theme应用不得访问Room client、WebSocket、server API或Macro/Library session。

### Settings control

* 在`src/App.svelte`的现有`settings-popover` control stack中新增一个labelled compact select，稳定test id为`theme-select`。
* select顺序固定在popover header之后、现有Drag terminals control之前；其36个option按`system`、root catalog所列35个theme的顺序展示。
* change event只调用existing `updateSettings({ theme })`路径；保存与document application由唯一settings lifecycle完成。
* selector使用可见label `Theme`并保留native keyboard interaction；不增加theme card、preview、search、第二层popover或topbar button。

## Frozen Semantics

* Settings button、dismiss layer、close button及其余control顺序和行为保持；唯一新增element group是Theme label/select。
* Home、topbar、Workspace、terminal、Macro和Library DOM不因本子任务变化。
* browser settings原有panel width/visibility、Macro insertion、drag、volume和Library preference default/validation保持，除schemaVersion/key和required Theme外不改。
* invalid current settings reset notice继续只由App现有notice path呈现。
* Theme change不要求Room controller，observer也可更改本地Theme；不会改变shared read-only或edit lease状态。

## Primary Files

* `package.json`、current lockfile、`vite.config.ts`、`src/main.ts`及新的framework entry CSS。
* `src/lib/browserSettings.ts`和一个轻量theme module。
* `src/App.svelte`中现有Settings block。
* `tests/unit/browserSettings032.test.ts`、新增theme-focused unit test、受影响UI inventory/current Settings E2E。

## Negative Boundary

* 不修改`server/**`、Room protocol/state、terminal lifecycle、Macro/Library/runtime source。
* 不以兼容名读取`themeName`、`colorMode`或任意旧/第三方shape。
* 不把Theme preference放进query string、Room id、record、cookie或server storage。
* 不在本change批量改全站class或删除legacy stylesheet；仅可为foundation entry和Theme control做必要presentation接线。

## Gate

* Unit：catalog精确包含35个不重复built-in id；36个preference均通过，未知/case-variant/extra value拒绝。
* Unit：v3 exact round-trip，v2 key不读取，v2 shape/missing/extra/invalid theme在v3 key下reset，default clone不共享引用。
* DOM/browser：Settings只新增`theme-select`，共36 options，native keyboard可用；topbar/Home无额外Theme入口。
* Browser：预置explicit dark settings并延迟application module时，至少跨两个animation frame断言正确root Theme/computed token且`#app`仍为空；正常启动后explicit theme即时设置并刷新保留，`system`跟随emulated color scheme，Theme在Home和Room一致生效。
* Transport：Theme切换期间没有新增HTTP/WebSocket/Room mutation。
* Build：Tailwind/daisyUI output存在且未破坏Vite route bridge；`just check`、`just build`、focused tests与`git diff --check`通过。
