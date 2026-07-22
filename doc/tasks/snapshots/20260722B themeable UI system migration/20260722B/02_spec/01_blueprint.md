# Blueprint Contract

## 任务边界

### Added Semantics

* Room现有Settings popover新增一个Theme选择控件，选项为`system`加下列35个daisyUI内置theme：
  `light`、`dark`、`cupcake`、`bumblebee`、`emerald`、`corporate`、`synthwave`、`retro`、`cyberpunk`、`valentine`、`halloween`、`garden`、`forest`、`aqua`、`lofi`、`pastel`、`fantasy`、`wireframe`、`black`、`luxury`、`dracula`、`cmyk`、`autumn`、`business`、`acid`、`lemonade`、`night`、`coffee`、`winter`、`dim`、`nord`、`sunset`、`caramellatte`、`abyss`、`silk`。
* Theme选择是browser-local exact setting，默认值为`system`；刷新后保留，并由stylesheet与application module前的同步head bootstrap在首次绘制前应用，`main.ts`在Svelte mount前复核。
* `system`实时跟随`prefers-color-scheme`；显式theme不受OS切换影响。
* Theme作用域覆盖同一browser内的Home、Room、terminal chrome、Macro、Library及notice，尽管选择入口只存在于Room现有Settings。

### Frozen Semantics

* 除Settings中新增Theme control外，DOM hierarchy、semantic element、role、test id、control数量/顺序/位置、tab与panel关系全部保持。
* 现有topbar、Home、Room、Workspace、terminal slot、Macro和Library布局不增加wrapper、drawer、modal、theme grid或独立navigation。
* 1600px、900px与720px代表的desktop/compact/narrow结构、panel宽度contract、resizer、overflow、sticky和scroll owner保持；父版本`max-width`的640/680/760/980/1100/1260px边界均为inclusive，精确边界不得漂移。
* Room single-controller、observer readonly、terminal lifecycle、PTY transport、Macro/Library authoring、Prepare、runner、notice行为和saved record contract不变。
* current可访问名称、keyboard interaction、focus order和disabled/readonly语义不因视觉迁移变化。
* Theme selection不发送Room message，不要求controller，不写server persistence，不进入Macro/Library record，也不跨设备同步。

## Framework Contract

* 唯一styled UI framework是Tailwind CSS 4与daisyUI 5；Svelte 5仍为component/runtime owner。
* 迁移优先直接在现有element上使用daisyUI component class、semantic color token和Tailwind utility，不用第三方component tree替换现有结构。
* 所有会被Tailwind scanner消费的class必须静态可发现；禁止模板字符串拼接任意utility name，动态状态使用静态class、Svelte `class:`或显式有限mapping。
* 新framework entry CSS只允许包含Tailwind layer、daisyUI plugin/theme注册和经formal review确认不可由markup表达的最小global bridge；禁止复制迁移前rule形成新legacy stylesheet。
* visual state使用semantic token表达。除明确列入xterm ANSI palette allowlist的值外，UI source不得残留hard-coded theme color。
* density是冻结的布局contract。daisyUI component必须使用compact size或等价utility恢复current control height、gap和信息密度，不能接受library default导致的结构变化。

## Browser Settings Contract

* `.001`直接把current browser settings key/schema升级到v3并新增严格Theme enum；loader只读v3 key，既有v2 key不读、不删、不转换，v3 key内的旧shape或其他invalid value才按current exact-schema规则reset；不添加migration、alias或dual reader。
* Theme写入沿用current browser settings owner和storage lifecycle，不新增第二个平行localStorage owner。
* 初始document theme由head中的parser-blocking bootstrap在任何stylesheet与application module前同步解析；无效或缺失current setting只落到formal default `system`，不猜测近似theme名。application module仍须在mount前重读并复核。
* OS color-scheme listener仅在选择`system`时更新effective theme和terminal palette，且必须随owner lifecycle正确清理。

## UI Structure Contract

* Theme selector放在Room现有Settings popover已有control区域，沿用现有label/control排列和关闭行为。
* 不新增topbar Theme按钮；不为RoomHome新增Settings；用户进入任一Room完成选择后，browser-local preference仍覆盖Home。
* Theme选项使用一个紧凑、可访问的原生或现有select形态，不新增theme preview card、搜索、分页或独立popover。
* 允许变化仅限颜色、border、shadow、radius、typography hierarchy、button/form外观及hover/focus/disabled/readonly/current-run视觉强度。
* 不允许通过“视觉优化”移动button、合并section、更换文案、改变content density、删减信息或增加decorative DOM。
* Structure oracle必须消费由`20260722A.002`父revision生成的稳定per-file fixture；除App允许Theme field精确四个element增量外，其余Svelte file的non-presentation entry逐文件exact一致，不接受迁移后自写aggregate digest。

## Terminal Theme Bridge

* xterm package-owned CSS继续由vendor import提供，不复制、不修改，也不计入project-authored legacy CSS残留。
* 项目维护一组审计过的light ANSI palette和一组dark ANSI palette；每个daisyUI theme按effective明暗归类后选择其中一组，terminal chrome仍使用daisy semantic token。
* Theme切换只原位更新现有xterm instance的theme option；禁止dispose/recreate terminal，禁止清buffer或重置viewport、selection、cursor、fit/parser状态。
* `system`在OS明暗改变时使用相同原位更新路径。

## Legacy CSS Removal Contract

`.004`完成时必须同时满足：

* `src/styles.css`和`src/styles/**`全部删除。
* 迁移前存在的project-authored Svelte `<style>` block全部删除；不得仅清空后保留占位。
* production entry与component不再import上述旧路径，current tests不再把旧file manifest或旧cascade hash当作真值。
* 不存在将旧selector/declaration整批复制到新CSS入口、compatibility layer或generated source的规避行为。
* residue Gate检查旧路径、旧import、Svelte `<style>`、已登记旧selector和UI hard-coded color；唯一颜色例外是formal allowlist内的xterm ANSI palette。

## 子任务Ownership

* `.001 UI framework and theme foundation`：dependency/build entry、theme catalog、browser settings exact schema、first-paint head bootstrap与pre-mount复核、Settings唯一Theme control与基础测试。
* `.002 App Room and terminal chrome migration`：Home/App/Room/workspace/terminal/notice presentation和xterm theme bridge，不触碰Macro/Library内部结构。
* `.003 Macro and Library workbench migration`：Macro、Library及shared workbench presentation，保留高密度authoring和runtime state contract。
* `.004 Legacy CSS removal and theme closeout`：删除全部剩余legacy CSS/import，替换old style oracle，执行全theme/viewport矩阵和full Gate，同步active specs。

## Negative Boundary

* 不修改backend、WebSocket transport、Room message、terminal protocol、MacroDefinition、Library schema或runner execution。
* 不增加旧setting兼容、自动迁移、theme alias、server theme或per-Room theme。
* 不把icon系统、文案改写、信息架构调整、component拆分或性能重构夹带进迁移。
* 子任务不得提前宣称全量legacy CSS清零；只有`.004`通过residue与full Gate后根任务可完成。

## Completion Gate

* Document Gate：root与`.001`至`.004`均有meta、context、formal spec、execution plan、review和task index。
* Code Gate：Tailwind/daisyUI pipeline唯一；36个选择值严格可用；UI structure inventory无越界变化；legacy project CSS最终零残留。
* Theme Gate：35个explicit theme与`system`均可选择、持久化、首次绘制前应用；无效值按exact schema处理；不产生Room/server mutation。
* Layout Gate：至少在1600px、900px、720px覆盖Home、Room、terminal、Macro、Library及关键readonly/running/disabled状态，无非预期overflow和control relocation。
* Terminal Gate：theme切换和system明暗切换均保留live xterm scrollback、viewport、cursor和continued output。
* Regression Gate：focused unit/component/browser tests、`just check`、`just build`、current integration/E2E、`git diff --check`及legacy residue扫描全部通过。
