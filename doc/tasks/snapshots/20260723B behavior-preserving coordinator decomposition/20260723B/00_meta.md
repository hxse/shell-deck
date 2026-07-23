# 20260723B Behavior-Preserving Coordinator Decomposition

## 任务概括

在`20260723A`已经落地的current产品状态上，继续收口四个仍然高耦合的ownership边界：Terminal Room manager、Macro record session、Library record session，以及Macro flow/lane editor。主任务只冻结共同规则、串行顺序与整链Gate；具体代码移动由`.001-.004`各自的正式task和独立`jj change`负责。

## 正式 task 级别及定级原因

三星任务。

本链不增加产品功能，但触及single-controller时序、PTY callback generation guard、saved-content lease/revision race、remote invalidation/retry、Svelte rune state、focus/Escape/restore-focus与recursive editor mutation。错误最可能表现为quietly wrong而非编译失败，因此必须使用完整Document/Code/Test Gate，并逐change证明外部行为等价。

## 范围内

* 保留`TerminalRoomManager`唯一公开API与唯一Room state，把control plane和terminal backend callback/cwd coordination拆为单向依赖模块。
* 保留Macro/Library现有factory为唯一rune state owner，各自抽出domain-specific MutationWorkflow与RemoteSyncCoordinator。
* 让`MacroInsertionPalette.svelte`拥有viewport placement、focus、Escape与restore-focus生命周期；flow tree与parallel lane各自抽取本域controller。
* 保留所有protocol、schema、DOM element/order、control order、class/presentation、文案与mutation gateway。
* 每个子任务独立change、独立spec、独立focused Gate与review证据。

## 范围外

* 不建立`GenericContentSession`、feature flag abstraction、second state owner、shadow Room registry或全局event bus。
* 不改变controller、heartbeat、mutation ticket、PTY/cwd、edit lease、expected revision、published-Create preservation、remote retry或navigation语义。
* 不重做UI、视觉、responsive、keyboard contract、test id或accessibility语义。
* 不借重构修复未由current contract授权的产品问题。

## 决策归属

用户已要求确认并直接修复四项finding、切换对应工作区/change并处理后续重基与冲突。默认style Gate scanner已在前置`20260723A`change收口；本root只覆盖其余三个产品区域，对应四个串行child change。若重基产生冲突，先停止并回到引入冲突的change，不以`jj resolve`猜测语义。
