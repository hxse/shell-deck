# Problem Context

## 使用场景与痛点

上一任务把暗色theme的`base-300`统一提升到至少3:1，并让Settings、Library及Macro control显式消费该token。边界因此变清晰，但也暴露出真正的问题：button、text input、select和textarea被当作结构divider渲染，页面充满同权重的矩形线框，交互层级反而更模糊。

Macro的问题尤其明显。其根节点用一长串descendant utility手工模拟input/select/textarea/button，而大量子组件中的原生element没有直接声明daisyUI component。这既绕开framework自己的background、depth、focus和disabled设计，也让一种祖先规则支配所有后代控件。

第一轮native surface收口后又暴露出两个presentation残余。其一，saved Macro的正常view mode仍沿用旧lock surface：所有field text被压到`base-content/55`，整个step card再叠加`opacity-75`，暗色Theme下形成双重降权；用户虽然能看出“不可编辑”，却无法舒服地阅读内容。其二，移除普通card border时也删除了旧`.flow-node-editor::before`的2px depth-color渐隐横线，相邻action/flow node只剩相近background与shadow，纵向列表缺少清楚的结束位置。

## 设计初衷

Theme framework应同时拥有palette和component language。应用负责说明“这是button/input/select/card/divider”，并为action声明primary、success、warning、error等语义；daisyUI根据当前theme生成颜色、surface、focus与状态。应用不应把所有元素都压成`border-base-300`，也不应按14个暗色theme重写palette token。

结构边界与控件边界需要拆开：pane之间、sticky header、line-number gutter、floating popover等确实需要物理分隔；button和表单控件应主要靠component形状、background、semantic state与focus outline表达可交互性。普通group/card在background和shadow足够时不再额外画线。

read-only是行为状态，不等于低可读性。正常saved Macro view应让内容保持与Edit mode相同的正文/field对比度，使用既有lock notice明确说明`Read-only · click to Edit...`；该提示本身也是用户指定的Edit入口，点击或用Enter/Space激活时复用既有`beginEdit()`获取content lease，不能把整个editor surface变成隐式点击区。active run、controller loss、pending或lease异常仍只由warning/error notice表达原因，不能误触进入Edit。flow node之间则确有结构边界含义，可以恢复一维separator，但颜色必须来自当前depth对应的`primary/secondary/accent/info` Theme token，不能恢复固定蓝色和独立CSS selector。

本地daisyUI 5.7.0的`business`进一步放大了surface hierarchy的重要性：`base-100`、`base-200`与`base-300`的OKLCH lightness分别约为24.4%、22.6%与20.9%，且`--depth`为0；默认button只使用`base-200`，`btn-soft`也只混入很低比例的semantic color。`input-ghost`、`select-ghost`与`textarea-ghost`则会把framework原本的background和border一起清空，附加相邻`base-200`仍不足以形成field surface。它们在暗panel上会与普通文字和background融在一起。这不是再加结构边界能解决的问题，而是应用没有向framework提供足够明确的action与field semantic。

## 方案对比

仅降低`base-300`混合比例会再次把所有边界绑在同一全局旋钮上，无法修正语义误用。继续为每个暗色theme添加不同override也会扩大自定义palette维护面。

直接采用daisyUI原生component是更窄的方案：删除dark selector/media override；raw Macro control直接获得component class；text/select/textarea使用framework ghost variant负责移除component border，再统一叠加`bg-base-content/15` theme-derived fill；普通可执行button使用solid semantic variant，只有移动、折叠、复制、取消等tertiary chrome使用ghost；正常read-only只由semantic notice标记，不降低内容alpha；flow node在既有element上用Tailwind `::after` gradient和built-in depth token恢复真实横向separator。

## 取舍结论

采用原生component、solid action hierarchy、统一field fill、full-contrast read-only content与semantic flow separator方案。`business`与其余theme的built-in `base-*`、`base-content`、semantic colors、`--depth`、`--noise`重新成为唯一palette真值；不再承诺普通边界3:1，也不靠`btn-soft`或紧邻base shade在`business`中勉强制造surface。`bg-base-content/15`对dark/light theme自动反向工作，不需要theme selector或逐组件颜色判断。flow separator与现有纵向guide共享depth semantic token，并由`to-transparent`渐隐，不增加DOM或stylesheet owner。可访问的keyboard focus由daisyUI component自身的outline负责，不能为了“无边框”移除focus indicator。
