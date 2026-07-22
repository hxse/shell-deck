# Problem Context

## 使用场景与痛点

用户更偏好`business`，希望首次使用shell-deck时直接得到这套明确的暗色外观。当前默认值是`system`，新浏览器会随OS选择light/dark，既不符合该产品默认，也让首次看到的外观随机器环境变化。

另一个问题是暗色theme里的边界层级太弱。以`business`为例，内置`base-100`与`base-300`非常接近；Macro表单、Library控件、panel、tab和分隔线大量使用这些semantic token，结果不是某个组件单独写错颜色，而是同一theme token在整个应用中都显得发灰、发糊。

## 设计初衷

默认偏好应由唯一browser settings默认对象决定，使first-paint bootstrap和application loader自然共享同一真值。边界问题也应在theme层解决：控件继续声明“这里是普通边界”，由暗色theme统一决定该边界应该多清晰，而不是每个panel各自挑颜色。

## 方案对比

一种方案是在Macro、Library、Settings和terminal chrome逐个加入更亮的border、outline或shadow。这能快速改善局部，但会产生大量surface特判，同一问题以后还会在新组件中重现。

另一种方案是保留现有semantic class，把canonical暗色theme的`base-300`统一改为由该theme自己的`base-content`与`base-100`混合得到，同时开启daisyUI control depth。当前少数仍依赖daisyUI隐式弱边框的现有control只需显式消费`border-base-300`；不引入固定颜色或业务组件selector。实现上，逐theme调用额外`daisyui/theme` plugin会为每个owner重新合并并输出完整built-in theme；一个精确列出canonical dark id的theme-token selector只输出实际变化的两个token，语义更窄且可由scanner校验。

## 取舍结论

采用第二种方案，并以单一explicit-dark theme-token owner加单一system-dark media owner落地。混合比例固定为60% `base-content`与40% `base-100`，目标是在所有canonical暗色theme中让关键1px边界相对`base-100`达到至少3:1 computed contrast。`base-300`从弱surface token收口为清晰边界token后，唯一把它当大面积背景使用的terminal host改用`base-200`，避免整块surface被同步提亮。

`business`只成为missing/invalid current settings的默认值。已有合法`system`或其他explicit theme仍原样保留；不做migration、不强制改写用户选择。
