# 20260725A Explicit Macro Insertion Icons

## 任务概括

把 Macro editor 中含义相反、难以辨认的“横线 + 加号”插入图标，统一为明确的结构操作语言：单箭头表示移动当前项，`+↑`表示在当前项之前插入，`+↓`表示在当前项之后插入。

## 任务级别

一星任务。改动只涉及局部 SVG、共享组件复用、accessible name 和对应测试，不改变 Macro schema、draft mutation、insertion anchor 或运行时行为。

## 范围

范围内：普通及嵌套 Flow node、Parallel lane action、For text-list item 的 before/after 插入图标；共享 `MacroIconButton` 真值；相关 active spec、focused test、E2E 和结构 oracle。

范围外：Text patch offset；其他 Macro 视觉重做；按钮数量、顺序、尺寸、颜色层级、focus、palette、test id；Move、Collapse、Remove 的行为；引入第三方 icon library或专用 CSS。
