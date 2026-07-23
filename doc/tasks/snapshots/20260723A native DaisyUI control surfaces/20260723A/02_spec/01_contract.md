# Formal Contract

## 任务边界

本任务保留`20260722C`的`business`默认Theme、first-paint bootstrap、35-theme catalog与existing valid preference语义，主要替代其边界presentation策略。允许修改class，不允许增加/删除/重排DOM element；唯一新增交互是normal saved Macro的既有read-only notice可直接触发现有`beginEdit()`。除此之外不改变事件、disabled/read-only、responsive或业务行为。

停止线是自定义dark theme owner清零、Macro control ancestor emulation清零、交互控件直接消费daisyUI component、显式outline-style control清零、代表性browser surface/focus断言与full regression完成。Theme catalog、storage或业务行为变化阻断Close Gate。

## 任务规范

### Theme ownership

`src/app.css`的daisyUI registration继续登记35个built-in theme，并保留`light --default`、`dark --prefersdark`以服务explicit `system`。应用不得再为`[data-theme]`或`prefers-color-scheme`覆盖`--color-base-*`、`--depth`、`--noise`或其他palette/component token；每个theme的built-in值必须原样生效。

项目继续禁止component-specific stylesheet、fixed color与额外CSS文件。`app.css`只保留framework directives、terminal font token和xterm运行时结构规则。

### Direct component semantics

普通text/number input必须在element自身使用`input box-border input-xs input-ghost bg-base-content/15`（尺寸有明确既有要求时可使用相应size）；native select使用`select box-border ... select-ghost bg-base-content/15`；普通textarea使用`textarea box-border ... textarea-ghost bg-base-content/15`。ghost component只负责移除daisyUI component border，统一的15% `base-content` fill负责在任意dark/light theme上形成方向正确的field surface；不得退回紧邻的`bg-base-100/200/300`，也不得按theme或component选择不同fill。项目不加载Tailwind preflight，因此`box-border`也是普通form component的直接必需语义，避免`w-full`的component padding与透明border从content box溢出。checkbox与range分别使用`checkbox`、`range`。这些control不得显式使用`border-base-300`，也不得依赖ancestor selector模拟border/background/focus/box-sizing。

button必须直接使用`btn`或属于`tabs`的`tab`。enabled command不得只使用无颜色的默认`btn`，也不得使用`btn-soft`：两者在`business`的紧邻base surface与零depth下不能稳定形成可辨识button surface。action hierarchy固定为：

* create、edit、prepare、validate、insert/add、普通执行命令与button形selection owner使用solid `btn-primary`；
* save/start等提交动作使用solid `btn-success`；panel/setting toggle与跨Macro/Library的load/save transfer使用solid `btn-secondary`；
* takeover、pause/resume与repair使用solid `btn-warning`；remove/delete/destroy/stop使用solid `btn-error`；
* Home/close/cancel/copy/reset/refresh/help、node collapse/move及tab close等低权重chrome action才使用`btn-ghost`；invisible dismiss layer与resize handle继续走既有例外。

disabled button可以由daisyUI原生disabled state降低对比。production中不得使用`btn-outline`或`btn-soft`，不得在button上显式使用`border-base-300`，不得用component-specific hover/background规则补画surface；selected/current state使用daisyUI `btn-active`/`tab-active`或solid semantic state，不用常驻border/ring表达。

透明全屏dismiss layer与resize handle不是可见control，可继续使用`border-0 bg-transparent`。复合code editor的inner textarea可继续`border-0`，但其外层editor region必须承担可辨识surface和focus owner。

### Read-only presentation

saved Macro的正常visual view mode必须保持与Edit mode相同的正文和field文字对比度；不得以`text-base-content/55`、ancestor opacity或相邻`base-200` field override二次降低内容。既有`macro-editor-lock-notice`是唯一正常read-only presentation与direct Edit interaction owner：message继续明确以`Read-only`开头，并使用daisyUI `alert-info alert-soft`说明点击该提示进入编辑。仅当reason精确为`content_edit_lease_required`时，notice具有`button` role、keyboard focus与pointer affordance；click、Enter或Space都必须复用既有`beginEdit()`，先获取fresh content lease，成功后才进入Edit。不得让notice以外的editor surface触发Edit。

controller/lease-lost/pending异常使用solid `alert-warning`，active run lock使用solid `alert-error`；这些notice继续是不可激活的status，也不能把正常可阅读内容作为状态提示一起变暗。既有pointer/keyboard mutation guard、content lease acquisition、server guard和Edit/Save行为不变。

### Structural boundaries

允许保留border的结构包括：app topbar/pane外框、pane header、line-number gutter、floating popover、terminal/text editor region、validation/log divider及确有嵌套边界含义的flow node。普通toolbar、palette section、status block、record/list card和control不得仅为“看起来像框”增加divider；background、card shadow、badge与component state足以表达时移除border。

每个`flow-node-editor`必须在既有article自身用static Tailwind `::after` utilities渲染2px bottom separator：从该depth纵向guide对应的`primary`、`secondary`、`accent`或`info` semantic color开始，经过同色透明度stop后渐隐到transparent。separator不得使用fixed color、`base-300`整宽border、额外DOM element、Svelte `<style>`或`app.css` selector。现有纵向guide继续由article/flow block上的`border-l-4`和同一组semantic depth class直接表达；横纵guide均是结构presentation，不是interactive control border。

### Frozen behavior

`DEFAULT_BROWSER_SETTINGS.theme`仍为`business`；missing/invalid current setting与first paint不变；已有合法`system`或explicit theme继续逐值保留。Theme切换、controller guard、content lease、Macro edit/run、Library CRUD、clipboard、notice与xterm lifecycle不变；唯一keyboard/pointer增量是normal saved Macro read-only notice直接委托既有`beginEdit()`，没有新的lease或mutation路径。

## 示例

```svelte
<!-- text control: framework component + semantic surface, no structural divider -->
<input class="input box-border input-xs input-ghost bg-base-content/15" />

<!-- destructive command: framework-owned solid semantic surface -->
<button class="btn btn-xs btn-error">Remove</button>

<!-- tertiary chrome: intentionally quiet, not a normal command surface -->
<button class="btn btn-xs btn-ghost">Cancel</button>

<!-- real floating boundary may retain a divider and shadow -->
<section class="rounded-box border border-base-300 bg-base-100 shadow-xl">...</section>

<!-- nested flow boundary: same element, current-theme depth color, no custom stylesheet -->
<article class="relative border-l-4 border-l-primary after:absolute after:bottom-0 after:h-0.5 after:bg-linear-to-r after:from-primary after:via-primary/70 after:to-transparent after:content-['']">...</article>
```

禁止恢复：

```svelte
<input class="border border-base-300 ..." />
<button class="btn btn-outline ...">...</button>
<button class="btn btn-soft ...">...</button>
<button class="btn ...">...</button>
<section class="[&_input]:border [&_button]:border ...">...</section>
```

## 测试

Static Gate必须证明app.css没有theme selector/media override；production没有`btn-outline`或`btn-soft`，没有无semantic variant的enabled visible `btn`，没有interactive control显式消费`border-base-300`；普通input/select/textarea必须直接拥有ghost component、`box-border`和唯一`bg-base-content/15` fill，不得使用相邻base fill；Macro descendant control emulation不存在；saved Macro lock surface不含正文/field dimming class；flow node同时保留semantic纵向guide和四个depth对应的semantic `::after` gradient。负例必须证明上述违规会被默认residue Gate拒绝。

默认residue Gate的代码边界也属于本任务停止线：`scripts/checkUiStyleResidue.ts`只保留source manifest编排、稳定public re-export与CLI；Svelte AST control semantics、Macro-specific presentation policy、app.css parser/theme ownership分别由`uiStyleResidue/svelteSemantics.ts`、`macroPresentation.ts`、`appCss.ts`拥有，issue/path/color等无policy helper由`shared.ts`拥有。现有测试继续只从原facade import，`just ui-style-residue`命令与输出contract不变；不得把三类policy重新合入CLI，也不得复制issue model或扫描入口。

Browser测试至少在`business`下验证Settings、Library与Macro代表性input/select/textarea/button：field computed background由统一`base-content/15` fill提供，rendered composite与所在base surface可测地区分，border保持透明；enabled普通command直接使用solid semantic variant，其rendered background与所在base surface可测地区分；tertiary action明确使用ghost；keyboard focus仍存在可见outline。保存Macro后必须验证normal read-only notice为`alert-info alert-soft`、内容computed color/opacity与Edit mode一致，并证明提示本身可由click及keyboard激活、调用既有lease acquisition后进入Edit；非normal lock reason不得获得该交互语义。至少两个不同depth flow node的`::after` computed background为非空linear gradient，起始tone分别跟随其纵向semantic guide并渐隐到transparent。另需切换一个light theme和一个非business dark theme，证明fill/separator随theme token工作且没有应用级palette override，并保留first-paint与existing `system`测试。

正式验证顺序为`just check`、`just build`、focused task test、`just test-unit`、`just test-e2e`、`just diff-check`。warning/error、static漏网、focus丢失、structure delta或full regression均阻断完成。
