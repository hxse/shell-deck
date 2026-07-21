# 20260721A.009 Split Macro Workbench Styles

## 任务概括

拆分`macro-workbench-base.css`、`macro-workbench-cleanup.css`和`macro-step-editor.css`，让Macro chrome、editor fields、Flow hierarchy、Trace和Library workbench样式各有明确归属。该任务只移动CSS规则，不改变任何像素、颜色、字号、间距、断点、状态或cascade结果。

## 正式 task 级别及定级原因

二星任务。

CSS移动看似机械，但三个文件存在历史覆盖层与共享selector。按视觉类别重排可能改变specificity tie、media query与source order，因此必须先建立selector/cascade inventory并用computed-style/截图回归证明等价。

## 范围内

* 建立现有selector、custom property、media query与覆盖来源清单。
* 按稳定组件ownership拆成小CSS模块。
* 保留一个明确的import manifest与原全局加载点。
* 删除迁移后的重复规则，最终每条规则只有一个owner。

## 范围外

* 不调整设计、配色、深度线、图标、按钮、字体或空间利用率。
* 不重命名class、不修改Svelte DOM或增加CSS-in-JS。
* 不合并“看起来相同”的规则，不修复既有CSS问题。
* 不改变非Macro/Library的Room、terminal与global styles。
