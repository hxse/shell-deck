# 20260722C Business Default and Dark Theme Border Contrast

## 任务概括

把新浏览器或无效current settings的默认Theme从`system`改为`business`，并通过daisyUI dark theme token统一增强暗色主题下表单、panel、tab与分隔线的边界辨识度。现有有效Theme选择继续保留，`system`仍实时跟随OS明暗。

## 正式 task 级别及定级原因

二星任务。

本任务修改browser-local公开默认行为、全部暗色主题的semantic token、framework residue Gate和浏览器视觉验收，涉及多个源码、测试和current doc文件；但不改变storage schema、DOM结构、业务流程或server/runtime contract，核心边界稳定。

## 范围内与范围外

范围内：`business`默认偏好、canonical dark theme catalog、daisyUI theme override、现有control对semantic border token的消费、system dark覆盖、computed contrast Gate、current active spec与Quickstart同步。

范围外：覆盖用户已有的有效Theme选择、改变35-theme catalog或settings schemaVersion、增加Theme入口、自定义Theme编辑器、组件专属颜色规则、布局/DOM/interaction重做、xterm ANSI palette调整，以及任何server、Room、Macro、Library数据或runner语义变化。
