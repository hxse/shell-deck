# Macro Editor Input Performance Contract

## 任务边界

本任务只优化Macro Visual authoring的本地编辑热路径与元素身份。MacroDefinitionV5、record CRUD、content edit lease、controller guard、validation、terminal adoption、explicit Save/Create/Start、DOM hierarchy、control order和test id保持不变。

交付停止线是：全部Visual字段继续通过单一draft gateway同步写入；连续输入或删除不再为每个事件深拷贝和替换definition根对象；任何可编辑persisted ID变化都不会让当前输入元素重建或丢失焦点；输入本身不发起Macro持久化请求。JSON editor与terminal/xterm性能不进入本任务。

P1/P2、输入丢失、焦点丢失、dirty错误、隐式Save、schema/DOM contract变化或任一project-authored source超过400行均阻断验收。浏览器与机器相关的绝对毫秒数不作为唯一Gate；本任务以确定性的工作量、DOM identity和行为断言证明性能根因已经移除。

## 任务规范

### 单一draft与同步mutation

`createMacroRecordSession`继续唯一拥有`draft`、`baseDefinition`、`dirty`和`draftRevision`。每个通过controller、operation、record edit/lease guard的Visual mutation必须在当前事件内同步修改现有deep rune draft；handler返回前，正式draft已经包含输入值。

普通Visual mutation不得先clone完整draft，也不得仅因字段值变化就给`draft`赋一个新根对象。accepted mutation仍恰好递增一次`draftRevision`。被guard拒绝的mutation保持现有拒绝原因，不修改draft、dirty或revision。

这条规则适用于text、textarea、number、checkbox和select等全部Visual字段；不能通过为各字段建立local shadow value、debounce queue、blur commit或异步flush规避。

### 精确dirty与持久化边界

安装saved record或成功持久化时，session建立与immutable base definition对应的稳定比较基线。Visual mutation后，`dirty`仍表示当前definition与该base是否逐JSON值相等；用户修改后完全恢复原值时必须重新变为clean。New draft没有base，发生mutation后保持dirty。

dirty计算不得在每次按键时重复序列化不变的base definition。允许对当前draft做一次确定性比较投影；该投影不成为第二份可编辑真值。

键盘输入、删除、select change与ID rename都只是browser-local draft mutation，不得触发Create/Update、lease acquisition、Prepare或Start。只有既有显式操作可以持久化。

### 稳定编辑器身份

可编辑的Node ID、Parallel Lane ID、Parallel Action ID和Parallel Output ID属于Macro definition内容，不是编辑器DOM identity。改变这些值时，当前input元素必须保持同一个DOM对象、保持focus，并保留浏览器管理的caret/selection。

递归Flow在insert、remove、move后仍须正确对应节点。For(text-list)的item row必须直接使用稳定item object identity，不能让父`node.id`、structure-version map或由二者生成的字符串参与key；逐字符修改父Node ID时，既有item card、key input和value textarea均不得重建。稳定identity只服务当前editor instance，不写入Macro schema、record、DOM attribute、local/session storage或server。安装另一份record/New draft时允许按既有editor generation重建编辑器。

duplicate或其他既有rename拒绝语义保持不变：拒绝时恢复当前authoritative value并显示原有notice。合法的逐字符中间值必须可以连续输入，不能因为旧ID已变化而让后续事件找不到目标。

### 冻结语义

现有Visual mutation command、terminal layout adoption/trim、collapse reconciliation、validation issue code/path/order、content lease、dirty unload guard、explicit Save/Create/Start和read-only/run-lock行为全部冻结。UI结构、按钮顺序、字段高度、主题class与test id不因本任务改变。

## 示例

主链：用户聚焦Send文本框，按住`a`再连续退格。每个input事件直接更新同一draft中的正文；输入元素始终保持focus；页面不产生Macro Create/Update请求，直到用户点击Save。

ID链：Node ID初始为`send`，用户全选后连续输入`prepare_result`。输入期间元素DOM identity不变，最终draft ID为`prepare_result`，引用该ID的既有collapse/editor状态按原规则协调；不会只接受第一个`p`。

反例：实现不能把`node.id`作为包含该input的key，也不能用“本地显示值已经变化，稍后再写draft”的方式掩盖卡顿。duplicate ID仍按现有规则拒绝，而不是临时接受后等Save报错。

## 测试

focused unit测试必须证明共享mutation：

1. mutation直接作用于传入definition并保持根对象identity；
2. accepted mutation精确维护dirty，改回base后恢复clean；
3. immutable base的比较投影只在base切换时建立，不在每次mutation重复建立；
4. New/no-base与baseline replacement具有明确且不丢状态的结果。

focused Playwright必须覆盖普通textarea或text field的长串输入与删除，以及Node、Parallel Lane、Parallel Action、Parallel Output ID的连续输入。ID测试记录输入元素对象并断言rename前后仍是同一对象、保持focus且draft/字段得到完整字符串；For(text-list)测试还要记录item card、key input和value textarea，并在父Node ID逐字符rename后断言三者仍是原DOM对象且值未丢失。同时监听Macro Create/Update网络入口，证明输入阶段为零请求。

最后顺序执行task-scoped test、check、build、unit、integration、Chromium E2E、file-size与diff-check。不得并发运行重命令。
