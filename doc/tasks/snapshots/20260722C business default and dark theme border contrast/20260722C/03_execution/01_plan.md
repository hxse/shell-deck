# Execution Plan

## 阶段一：真值与静态边界

* 从existing theme catalog导出canonical dark id，复用它驱动effective scheme与scanner。
* 把browser settings default改为`business`，保持key/schema/validator/bootstrap主链不变。
* 在`src/app.css`登记一个精确消费14个dark id的theme-token owner，并用一个dark media owner覆盖system dark。
* 扩展`ui-style-residue` allowlist与exact guard，拒绝selector缺失/重复、额外property、错误mix/depth和system media归属漂移。

阶段验收：focused unit先证明default、catalog和scanner正反例。

## 阶段二：现有surface消费

* Settings select与Library现有input/select显式消费`border-base-300`。
* 保留Macro现有统一descendant semantic border，不新增Macro专属规则。
* 将terminal host唯一`bg-base-300`大面积surface改为`bg-base-200`。
* 不改变DOM、control inventory/order、responsive class或xterm lifecycle。

阶段验收：structure oracle无新增delta，browser representative surface与control状态保持。

## 阶段三：验证闭环

* 新增first-paint default与已有`system`保留测试。
* 新增14 explicit dark加system dark的computed contrast matrix，实际测量Settings、Library、Macro与panel。
* 增加`just test-20260722c` focused入口，并把新增unit纳入`test:unit:core`。
* 严格串行运行`just check`、`just build`、focused、full unit、full E2E和`just diff-check`。

## 阶段四：current docs与审阅

* 同步`ui_theme_contract.md`、`user_data_storage_contract.md`和Quickstart；不回改`20260722B`历史snapshot。
* 回填task index与`04_review`的真实命令结果。
* 同时审阅代码和文档：逐条映射spec，检查旧默认、重复dark catalog、fixed color、`bg-base-300`surface、测试oracle与warning。
* 最后核对`jj status/log/diff`与conflict状态；如本次自动rebase产生冲突，立即`jj undo`，不自行`jj resolve`。

## Legacy Kill List

* current源码、测试与current docs中把fresh/reset默认写成`system`的口径。
* canonical dark theme继续直接使用低对比built-in `base-300`的路径。
* Settings/Library关键control只依赖daisyUI implicit弱边框的presentation。
* production中把增强后的`base-300`当大面积background使用的class。
* scanner允许theme override存在但不校验exact owner/property/value的缺口。
