# Contract

## 任务边界

### Added Semantics

无。

### Frozen Semantics

* 所有selector匹配集合、specificity、source order有效结果和custom property值冻结。
* 所有viewport断点、overflow、resize、sticky/flex/grid、focus/hover/disabled/collapsed状态冻结。
* Macro深度线与颜色循环、Action controls、autosize Text、JSON/Trace字体和面板密度冻结。
* Library tabs/list/editor/lease/notice与Macro/Library切换按钮样式冻结。
* DOM/class/test id完全冻结；本任务只改CSS文件组织与imports。

### Primary files

* `src/styles/macro-workbench-base.css`
* `src/styles/macro-workbench-cleanup.css`
* `src/styles/macro-step-editor.css`

## 任务规范

### 目标模块

* `src/styles/macro-chrome.css`：Macro/Library切换、toolbar、selector、run controls和panel chrome。
* `src/styles/macro-editor.css`：visual/JSON fields、validation、text autosize和editor-local controls。
* `src/styles/macro-flow.css`：node chrome、depth rails、branches/lanes、collapse/move/add/remove与responsive flow布局。
* `src/styles/macro-trace.css`：Trace/runtime status/event rows。
* `src/styles/library-workbench.css`：Library scope/kind/list/search/editor/lease/notice。
* 一个workbench style manifest按证明等价的顺序导入上述模块。

模块名可按最终selector inventory微调；若一个规则真正跨域，应进入明确shared文件而不是复制。

### Cascade preservation

* 实施前生成重复selector与source-order依赖清单。
* 规则声明内容保持byte-equivalent，第一阶段不做属性排序、缩写展开或格式化重写。
* 对相同specificity覆盖，迁移后有效source order必须相同。
* media/supports块整体移动，不拆散内部相对顺序。
* 最终旧大文件可成为只含imports的manifest或删除并更新唯一入口，但不得同时加载旧/新产生重复cascade。

### 不允许的“清理”

* 删除浏览器当前不匹配但属于动态状态的selector。
* 合并颜色/尺寸为新token。
* 用`:is()`、nesting或更高specificity重写。
* 根据截图“差不多”接受1px、字体或overflow变化。

## 示例

### 合法

将连续且同属Flow node的一组规则原样移动到`macro-flow.css`，manifest放在原加载位置和等价source-order区间；computed style和截图像素一致。

### 非法

把cleanup里的某个后置override移到base规则之前，虽然声明内容没变，却恢复了旧颜色或高度。

## 测试

### Static

* selector inventory迁移前后集合一致；无重复加载、丢失selector或新增class依赖。
* import graph无cycle，workbench styles只有一个入口。
* 搜索旧文件确认没有遗留implementation或双重规则。

### Browser visual

* 固定viewport覆盖Macro Editor/JSON/Trace、Library三kind、collapsed/nested/Parallel、validation/readonly/pending/toast。
* 对关键元素断言computed font/size/color/border/padding/gap/overflow/display/position。
* before/after截图pixel diff必须为零；字体渲染环境差异需用同一browser/container执行。

### Gate

运行current UI/E2E、visual screenshot/computed style suite、`just check`、build与`git diff --check`。任何视觉差异均阻断，不以“更好看”为理由接受。
