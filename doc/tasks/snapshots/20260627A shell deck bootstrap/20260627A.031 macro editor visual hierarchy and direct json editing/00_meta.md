# 20260627A.031 Macro Editor Visual Hierarchy And Direct JSON Editing

## 任务概括

改善 shell-deck 当前几个容易造成误操作的编辑体验：让 Macro Flow 的嵌套层级和同级节点边界更清楚且接近 IDE indent guide，压缩 Macro 非正文 chrome 和重复控件占用，让 Text tab 显示行号，让 tab 双击重命名立即获得输入焦点，并让 Macro JSON 从只读预览升级为显式、受校验和 dirty-state 保护的直接编辑入口。

## 正式 task 级别及定级原因

二星任务。

本任务不改变 macro schema、runner 或 terminal protocol，但涉及 Macro 递归节点 UI、Text tab 编辑器、tab rename focus/blur 时序，以及 JSON buffer、模板选择和视图切换之间的状态所有权。改动跨多个 Svelte 组件并存在未保存内容丢失风险，因此需要中等强度 spec、阶段计划、focused E2E 和最终审阅。

## 范围内

* 为每个 Macro body depth 使用稳定、清晰且相邻不同的 IDE accent 缩进 guide 颜色；每层 guide、node 左边框和下边 branch 全部使用同色、同粗的 2px 连续实线，guide 与 node 左边框精确重合；node 不绘制上边线。
* `if/elif/else` 只作为无边框 branch section，不产生额外缩进或阴影 rail；内部 action body 是唯一正式缩进，并与同层 `for body` guide 对齐。
* 删除所有可点击 body summary，只保留静态 `Flow V2 Body`；普通 Flow node 与 Parallel lane action 统一使用标题行右侧单组六个标准 Macro 风格 SVG icon buttons，固定顺序为 Collapse、Move up、Move down、Add before、Add after、Remove；collapsed card 使用明确 badge 与 depth-color tint，badge 不得推动操作栏。
* collection item 与 branch 上的通用 `Up`、`Down`、`Remove` 统一为共享 icon-only button；`Add Text`、`Add inside`、`Add elif`、`Add else`、`Add item`、`Add filter` 等表达具体创建语义的动作继续保留文字。
* Remove 使用统一的 Lucide Trash2 风格；IF、ELIF、ELSE 的右侧 action group 以独立折叠图标开头，再排列 Add/Remove；只折叠本 branch 的 condition/body，不隐藏 label actions，也不写入 template JSON。所有折叠 surface 统一使用 `Collapsed` badge + 浅蓝 active toggle，branch badge 不得推动右侧 action group。
* 统一 IF family 的 branch-local chrome：IF/ELIF label 行承载新增 branch，ELIF/ELSE label 行承载删除自身，ELSE 存在时全局隐藏该 IF node 内所有 `Add else`。
* bottom branch 的 mask 在 18% 后开始淡出并于 52% 完全透明，缩短视觉延伸。
* 同级 Macro 节点只使用留白分块，不保留独立横向 divider。
* 把 idle runner 状态与控制收进单行 dock，并分别校准 view tabs、runner controls、node actions、整个 workspace topbar、terminal tabs 和 terminal meta 的视觉尺寸，避免同栏出现两套尺度。
* 把 Macro 核心标题、字段、正文和操作字号整体提高一档，并让 JSON preview/editor 使用更大的等宽正文。
* 在不回退前述正文空间优化的前提下，把 workspace Macro/Prompt 栏和 Macro template/Reset width 栏各回调一档，并统一 Macro、Prompt、Trace 的 header、section、field、action 与 tab 视觉尺度。
* 删除 `if` / `elif` / `else` / `for` / `finish` / `break` / `continue` 自带的命名 inside/action 按钮；空 flow body 只保留一个通用 `Add inside` 占位，非空 body 继续从既有 child node 使用 Add before/after。
* Parallel lane action 插入器复用主 Macro insertion overlay、palette、placement、viewport clamp、focus、Escape 与 scrim 行为，不保留独立 inline popup 样式。
* 为 Text backend 的全高编辑器增加与滚动同步的 1-based 行号。
* tab 双击进入 rename 后自动 focus，caret 落在 alias 末尾；合法内容在 blur 时沿用现有提交逻辑。
* Macro JSON 默认只读；显式 Edit 后使用独立文本 buffer，并提供 Save、Cancel、Copy。
* JSON Save 依次执行 JSON parse、当前 schema validation、template identity validation 和 server save。
* JSON edit mode 未经 Save 或 Cancel 不得切换 Editor/Trace、替换当前模板或启动 Runner。
* JSON Edit lock 覆盖请求已经发出但尚未提交的异步窗口：pending template operation 期间不能进入 Edit，也不能修改 visual draft；整个 editor 必须 disabled/inert，所有 mutation 统一回到 MacroPanel。operation identity 同时冻结 draft revision，每次 await 返回后重新核对 generation、config/template/revision 与 `jsonEditing`；Runner Start 只有通过保存后的复核才可发出。
* editor-local collapse state 以当前 template mount 为生命周期；切换 template 时重置，删除 node/IF branch/Parallel lane 时递归回收所属 collapse keys，删除后复用相同 id 不得继承旧折叠状态。
* 增加 unit/E2E 回归并同步 active specs、quickstart 与 task index。

## 范围外

* 不修改 Macro JSON schema、runner 语义、terminal protocol 或存储格式。
* 不引入 Monaco、CodeMirror、语法高亮、格式化、自动补全、undo history 或 JSON diff。
* 不给 shell/xterm terminal 增加行号，不给所有普通 textarea 统一增加行号。
* 不增加全应用路由离开确认、浏览器 beforeunload 提示或 JSON 自动保存。
* 不改变 alias 字符集、唯一性规则、Enter/Escape 语义或服务端 rename contract。
* 不重做全局 design system，不压缩 terminal/Text 正文字号，不重设计 Settings popover 内部控件，不把 runner waiting-input 编辑器塞入单行。
* 不改变 flow node schema、普通 action 的 Add before/after insertion command 语义、Parallel lane action 集合或普通 node insertion command 语义；node action 的 icon chrome 和 IF branch 的 contextual insert/remove command 属于本任务明确范围。
