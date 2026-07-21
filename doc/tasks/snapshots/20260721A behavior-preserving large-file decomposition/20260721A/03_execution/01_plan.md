# Planning Blueprint

## Change链

主change只冻结总体目标、顺序和共同Gate。`.001-.010`各自拥有独立spec、execution plan和未来review，不把十个区域揉成一个不可审阅的大重构。

## 实施节奏

每个子任务未来按相同步骤执行：

1. 在对应change记录primary files当前职责和focused Gate。
2. 先建立或确认行为characterization，不修改功能。
3. 建立目标模块并机械迁移一类职责。
4. 让原入口退化为facade/composition root，删除旧重复实现。
5. 运行focused Gate与全局静态Gate。
6. 更新该change的review证据后，才进入下一change。

## 依赖与停止条件

* `.001-.002`先稳定server入口与共享validation facade。
* `.003-.006`再拆browser orchestration和编辑器，避免同时移动协议与UI。
* `.007-.008`最后拆server runtime核心，使用前面稳定的transport和validation边界。
* `.009`在DOM结构稳定后机械重组CSS。
* `.010`只重组current tests并执行整链验收，不承接产品修复。

出现以下任一情况必须停止当前拆分：

* 必须改变公开contract才能继续。
* 同一state需要两个owner才能让新边界成立。
* focused test只能通过放宽断言。
* UI或protocol产生无法解释的差异。
* 新模块形成cycle或只能依赖入口内部细节。

停止后应回到边界设计，或另建功能/bug task；不得以“重构需要”为理由吞掉差异。
