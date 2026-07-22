# Formal Contract

## Added Semantics

### Workbench visual language

* Macro与Library existing elements使用daisyUI semantic component class和Tailwind static utility迁移，统一base/content/neutral/primary/success/warning/error token。
* Workbench保持IDE-like compact density：existing field/control height、row gap、nested indentation、toolbar wrapping、panel padding和monospace data surfaces按baseline geometry显式表达。
* interaction state必须在全部theme中清晰：hover、keyboard focus、pressed/selected、disabled、aria-disabled、native fieldset disabled、readonly、pending、dirty、warning、error、success、active run和current node。
* readonly/disabled不只依靠轻微opacity；必须同时有semantic surface/border/cursor或existing status text，且native disabled/defensive mutation guard仍是行为真值。
* current run node使用明显semantic border/ring，run dock保持高对比status badge和`type · id`/Parallel lane stage；颜色不是唯一标识，现有文字和state attribute保持。

### Static utility rules

* 不运行时拼接Tailwind utility name。conditional presentation使用Svelte `class:`、静态完整class list或有限显式mapping。
* 不为每种Macro node创建重复style wrapper/component；复用existing `MacroIconButton`、`MacroWorkbenchChrome`、`NodeActionControls`等真实component owner。
* dynamic palette position、panel width、line transform和runtime-measured geometry可继续使用inline style/custom property；theme color、spacing或state不能通过任意inline CSS逃逸。
* arbitrary value只用于冻结current geometry或复杂grid/overflow，不用它重新硬编码每个theme颜色。

### Legacy workbench removal

* 本change删除：`macro-workbench.css`、`macro-chrome.css`、`macro-editor.css`、`macro-flow.css`、`macro-trace.css`、`library-workbench.css`、`workbench-responsive.css`、`workbench-shared.css`及其production import。
* 删除`MessagePartsEditor`、`TemplatableScalarField`、`MacroJsonView`、`MacroControlNodeEditor`、`MacroFlowNodeList`、`LineNumberedTextarea`、`ExtractTextEditor`、`MacroStepList`、`MacroTerminalSelect`、`TerminalInputDeliveryField`中的existing `<style>` block。
* 删除`.002`remaining selector manifest中所有Macro/Library consumer rule；若发现未登记consumer，先补inventory和test再迁移，不能留给`.004`作为未知债务。
* 不把以上rule复制到new workbench CSS、Svelte `<style>`或compatibility layer。

### Current style oracle replacement

* current `.009`rule-count/hash/repeated-cascade/file-manifest oracle在本change明确退役；对应历史task snapshot不修改。
* replacement structure oracle提交由`20260722A.002`revision生成的稳定per-file fixture，保存每个Svelte file的non-presentation entry count/digest；本任务25个workbench component逐文件与父基线exact匹配，不接受迁移后重新手写aggregate digest。
* replacement current tests同时冻结：workbench component/control/test-id inventory、listed legacy source absence、no component `<style>`、compact control geometry、nested indentation/overflow、responsive layout和关键semantic states。
* computed-style assertions使用semantic relationships或resolved token差异，不把某一个built-in theme的具体RGB重新当成全局产品contract。
* `.004`在此基础上加入全项目legacy residue和全部theme matrix，不重复恢复旧cascade hash。

## Frozen Macro Structure and Behavior

* `MacroPanel.svelte`与`components/macro/**`现有element tag、nesting、sibling/control order、role、aria、test id和handler保持；只修改class和必要非结构presentation attribute。
* Macro toolbar、record selector/New/Edit/Save/Cancel/Copy/Remove/Refresh、Save to Library、Visual/JSON、Validation、Prepare、Start/Pause/Resume/Input/Stop和Trace位置不变。
* action/control node、Parallel lane、For item、nested body、insertion palette和template token controls不增加/删除/移动。
* For每个text-list item的向上/向下插入icon action保持；icon含义、accessible label和插入位置行为不变。
* title/template enable后只出现三个紧凑`{{index}}`、`{{key}}`、`{{value}}`insert buttons，不恢复`Available: ... from for`提示。
* Parallel保持无text-output authoring；不得恢复capture/text collector field。
* active run锁定selector、visual authoring和JSON Edit；fieldset native disabled、run-lock status和defensive mutation guard保持，视觉上不得呈现为可编辑。
* current node只根据frozen running definition/currentNodeId定位；不存在于local draft时不猜测、不切selection。
* validation、terminal choices、artifact/template parsing、Save/Create/Start、Prepare和runner state machine不改。

## Frozen Library Structure and Behavior

* `LibraryPanel.svelte`现有element tag、nesting、kind tab/search/selector/action/field order、role、aria、test id和handler保持。
* saved detail默认readonly，Edit lease、observer、pending、lease lost和published-Create preservation继续由existing session决定editability。
* Macro JSON Validate/Load、Save/Copy/Remove/Refresh、New/Edit/Cancel行为及位置不变；不增加Duplicate/import/export。
* panel visibility/width/resizer属于`.002`outer shell，`.003`不得改变其position或settings lifecycle。
* selection/draft/dirty/invalidation/reconnect/beforeunload逻辑不改。

## Responsive Contract

* 1600px保持full workspace和current high-density workbench；900px保持current compact topbar/side panel geometry；720px保持current narrow flow/control wrapping。
* repeated selector的旧source order不再是contract，但其可观察结果必须保留：run list control typography、`<=760px` run controls layout以及后续cleanup override的最终geometry不得回退。760px本身严格属于窄侧；source使用显式inclusive media variant，不使用只覆盖`<760px`的`max-[760px]`。
* nested flow不得横向推出panel；code/textarea/trace拥有current scroll/wrap owner；fixed/sticky run feedback不得遮住authoring controls。
* daisyUI default min-width/padding不能造成button/label/control relocation。

## Primary Files

* `src/lib/components/MacroPanel.svelte`、`LibraryPanel.svelte`和`src/lib/components/macro/**`。
* 八个listed workbench CSS modules、`src/styles.css`对应import，以及`.002`交接的mixed-file selectors。
* current UI control inventory、Macro/Library comprehensive E2E、visual editor/run feedback/Library session focused tests和current style oracle。
* 仅当presentation class prop直接需要时修改Workspace outer component；不得改变其markup/layout ownership。

## Negative Boundary

* 不修改`src/lib/macro/**`editor command/definition/session/runner behavior或`src/lib/library/**`session/client state machine。
* 不修改server/API/protocol/fixtures saved schema，不用数据变化绕过视觉状态测试。
* 不添加icon library、全新design component abstraction或跨domain generic form system。
* 不删除“不好迁移”的control、label、status、warning、trace field或test coverage。
* 不修改历史`20260721A.009`snapshot来重写当时的behavior-preserving结论。

## Gate

* Structure：Macro/Library每个component的DOM fingerprint必须消费`20260722A.002`per-file fixture并除class/style外exact不变；所有近期`.001`controls/states仍存在且位置相同。
* Legacy：八个CSS modules、aggregator import、10个component `<style>`及`.002`交接selectors全部消失，无copy-to-new-CSS residue。
* State：controller/observer、view/edit/lease lost、clean/dirty、valid/warning/error、pending、active run locked、paused/waiting/current node均有behavior + computed semantic state断言。
* Geometry：1600px、900px、720px覆盖deep nested flow、Parallel、For text list、template tokens、JSON editor、run trace和Library edit/detail，无非预期overflow/control relocation；另在760/761px对template selector与insertion action grid断言窄/宽侧精确切换。
* Theme：以light、dark、synthwave、corporate、wireframe等代表性theme运行关键Macro/Library state；不得残留固定light surface或不可辨识readonly/current state。
* Behavior：current Macro/Library focused unit与comprehensive E2E、Prepare/Start/runner/lease/reconnect journeys继续通过。
* Quality：`just check`、`just build`、relevant current test suites、new oracle和`git diff --check`通过。
