# 20260722B Themeable UI System Migration

## 任务概括

以`20260722A.002`完成后的current产品为基线，在不改变既有UI结构和产品行为的前提下，将全部project-authored presentation迁移到Tailwind CSS 4与daisyUI 5。最终删除迁移前的`src/styles.css`、`src/styles/**`和现有Svelte component `<style>`内容，不把旧声明原样搬进新的legacy stylesheet；同时提供`system`和daisyUI全部35个内置theme的浏览器本地切换能力。

## 正式 task 级别及定级原因

三星任务。

本任务有意保持业务语义不变，但会横跨所有前端surface、构建依赖、browser settings、xterm palette、responsive contract及current style oracle。风险主要来自全局cascade、默认组件尺寸、terminal渲染和高密度Macro editor，而不是新功能复杂度，因此必须分四个子任务渐进迁移并在最终change统一清除旧CSS。

## 已拍板决策

* UI framework使用Tailwind CSS 4与daisyUI 5，不并行引入第二套styled component framework或headless interaction library。
* Theme入口只加入Room现有Settings popover；这是本任务唯一允许新增的UI结构。
* 提供`system`选择和daisyUI全部35个内置theme，不自造一批与内置theme重名或近似的皮肤。
* Theme属于browser-local presentation preference，不进入Room state，不走server transport，不触发controller guard，也不建立跨设备同步。
* 全面迁移完成前允许子任务内短暂共存新旧style owner；`.004`结束时迁移前project-authored CSS必须为零残留。

## 范围内

* 建立Tailwind/daisyUI build pipeline、semantic theme token与compact density约束。
* 扩展current browser settings exact schema以持久化Theme选择；stylesheet与application module前的同步head bootstrap负责首帧Theme，`main.ts`在Svelte mount前复核。
* 逐surface迁移App、Room、terminal、Macro、Library和shared workbench presentation。
* Theme变化时原位更新xterm theme，不重建terminal，不丢失scrollback、selection、cursor或parser状态。
* 替换只适用于旧cascade的current style oracle，新增结构、几何、状态和全theme matrix Gate。
* 删除全部迁移前project-authored CSS source与import，并增加可重复执行的residue检查。

## 范围外

* 除Settings内Theme选择控件外的任何UI结构变化。
* 修改Room/terminal/Macro/Library/runner protocol、schema、persistence或运行语义。
* 借迁移改文案、调整control顺序、合并panel、重做navigation或加入新功能。
* 为旧browser settings shape添加migration、alias、dual reader或自动转换。
* 修改第三方xterm vendor CSS；其package-owned stylesheet不属于待删除的project-authored legacy CSS。

## 决策归属

人工已拍板全面迁移、全面清除旧CSS、支持大量theme，并明确唯一结构变化只能是Theme入口。AI可依formal spec建立任务链、实施迁移、自审并修复明显问题；任何额外结构变化或产品行为变化都必须停止并另行取得用户决定。
