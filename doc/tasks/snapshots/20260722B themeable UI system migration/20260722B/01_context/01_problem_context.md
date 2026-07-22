# Problem Context

## 当前状态

`20260722A.002`基线的前端presentation由`src/styles.css`、`src/styles/**`和多个Svelte component-local `<style>`共同承担。现有样式可以支撑current UI，但颜色、边框、状态、responsive cascade和surface owner分散，主题token数量有限，大量视觉值直接写死；继续在其上追加多套皮肤会扩大cascade和重复selector风险。

当前UI同时包含三类对迁移敏感的surface：

* App/Room/terminal chrome，要求保留多slot布局、tab、resizer、notice和live terminal viewport语义。
* Macro/Library high-density workbench，要求保留复杂nested flow、current run、readonly、insertion control和窄viewport布局。
* xterm canvas/DOM renderer，要求theme切换只改变palette，不重建live terminal或干扰scrollback。

## 为什么建立独立主任务

这不是`20260722A` bug-fix series中的局部修复，而是有明确终态、跨全部前端surface的presentation platform替换。它需要自己的framework contract、迁移ownership、残留Gate和closeout，不应混入已有`.001`/`.002`修复change，也不能用一个巨型change同时改完并失去逐阶段可审阅性。

## 用户约束

* 最终必须全面清理旧CSS，迁移前内容一行不留。
* 目前的UI信息架构、panel关系、控件位置和交互流程保持不变，只替换视觉样式和theme。
* Theme入口可以位于顶栏或Settings；本任务选用现有Settings，以最小化结构变化。
* Theme数量必须足够多，且应使用UI library内置、可维护的theme，而不是继续堆项目自有硬编码色板。

## 选型结论

Tailwind CSS 4负责可扫描的utility、responsive/state variant和build-time CSS生成；daisyUI 5负责semantic component vocabulary与内置theme token。该组合允许沿用现有Svelte DOM，在原element上添加class即可迁移，不要求把页面重写成第三方组件树，符合“结构不变、presentation替换”的核心约束。

daisyUI 5提供35个内置theme；加上跟随OS的`system`选项，Theme selector共36个选项。Macro flow等非标准高密度区域可以使用Tailwind utility、arbitrary value和data/state variant表达，但必须继续引用semantic theme token，不能把旧CSS逐行转存到另一个文件。

## 主要风险

* daisyUI默认component尺寸可能放大current high-density UI，造成control换行、panel溢出或responsive断点漂移。
* 分阶段迁移期间新旧cascade可能互相覆盖，必须明确每个style owner何时删除。
* Tailwind source scanner无法识别运行时拼接class；动态状态必须使用静态class集合、`class:`或显式mapping。
* daisyUI semantic colors不能直接替代terminal ANSI 16-color palette；xterm需要独立、审计过的light/dark palette桥接。
* 现有style tests冻结旧文件manifest和cascade顺序，迁移后应以current结构/几何/theme contract替换，而不是无断言地删除。

## 成功定义

用户可以从Room现有Settings选择`system`或任一内置theme；Theme立即覆盖Home、Room、terminal chrome、Macro和Library surface并在刷新后保留。所有current UI结构和产品journey继续工作，三档viewport不出现结构漂移，live terminal状态不受theme切换影响，迁移前project-authored CSS及其current import/test oracle最终全部清零或被明确替换。
