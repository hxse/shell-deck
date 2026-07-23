# 20260723A Native DaisyUI Control Surfaces

## 任务概括

保留新browser默认`business`，但撤销人为增强全部暗色边界的方案。交互控件直接使用daisyUI的`btn`、`input`、`select`、`textarea`、`checkbox`、`range`与`tab`语义；可执行button通过solid semantic variant建立surface与action hierarchy，普通form control通过ghost component与统一`base-content` translucent fill建立无边线field surface。只有真正低权重的chrome action使用ghost，pane、header、gutter、popover等真实结构边界继续使用divider。

## 正式 task 级别及定级原因

二星任务。

本任务会统一调整App、Home、Macro、Library与notice中的control presentation，移除全局dark theme override，修改style residue Gate并增加browser视觉验收；DOM element结构、storage schema、server/runtime与业务contract不变。唯一interaction增量是normal saved Macro的既有read-only notice可直接委托既有`beginEdit()`获取content lease。

## 范围内与范围外

范围内：移除dark theme CSS特判；交互控件直接声明daisyUI component；移除control上的`border-base-300`与`btn-outline`；以原生solid semantic button、统一theme-derived field fill、ghost chrome、active与focus状态替代；收敛不必要的card/palette边框；normal read-only notice支持click/Enter/Space进入既有Edit lease流程；静态与browser Gate；current docs同步。

范围外：改变`business`默认、35-theme catalog、existing setting保留、Theme入口、除上述notice委托外的Macro/Library业务行为、DOM element/order、responsive geometry、xterm palette与用户自定义Theme。
