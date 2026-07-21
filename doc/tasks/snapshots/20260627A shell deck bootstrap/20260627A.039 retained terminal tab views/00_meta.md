# 20260627A.039 Retained Terminal Tab Views

## 任务概括

修复terminal tab切换时重复销毁和重建xterm的问题。当前界面只渲染active terminal，并用terminalId keyed block强制切换组件；因此每次从Shell切到Text再切回Shell，都会重新创建xterm并把最长2 MiB replay从头送进parser。长Codex TUI历史会明显自上而下重新滚动，即使Codex已经退出也一样。

本任务把tab切换还原为纯browser-local可见性变化：terminal runtime、server replay和Room状态不因切换改变；已经访问过的Shell/Text view保留到terminal被删除或Room页面退出。

## 正式 task 级别及定级原因

二星任务。

改动集中在workspace terminal view lifecycle、xterm尺寸处理和browser E2E，不修改server protocol或Macro语法；但错误处理会影响长历史性能、Text在途输入、PTY resize和terminal query，因此不能作为零星CSS修复。

## 范围内

* terminal pane首次访问后的保留、隐藏、重新显示和删除清理。
* Shell隐藏期间继续消费server-authoritative live delta，重新显示时只做必要尺寸校准。
* Text pane保留textarea DOM、本地写状态与滚动位置。
* 长replay切换不重新hydration的确定性browser测试。
* 真正首次mount/reload/replace hydration继续关闭xterm stdin，历史terminal query不得回灌PTY。
* 收口current full E2E discovery：保留`.031A`历史journey原文，但不再把它注册成当前产品spec。

## 范围外

* 不修改Room、PTY、replay、terminal revision、server broadcast或持久化语义。
* 不引入terminal view eviction、数量上限、后台暂停output或虚拟化terminal emulator。
* 不运行真实Codex，不依赖外部网络或在线服务。
* 不借机调整terminal/tab视觉、Macro/Library UI或20260721A拆分边界。
* 不改写、弱化或删除`.031A`历史journey及其冻结断言。

## 决策归属

用户已明确terminal状态不应因纯tab切换变化，并要求寻找根因后合理修复。实现不存在需要人工选择的公开契约分叉；AI按最小生命周期修复直接落地。
