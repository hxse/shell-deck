# Problem Context

## 当前runner polling不是Room同步真值

.034的runner执行在server，但MacroPanel仍每900ms主动GET并把结果放进当前browser本地状态。它能让单页面“看起来在更新”，却没有定义新连接的初始snapshot、多个页面的更新顺序、takeover后的runtime input草稿归属，也让关闭页面后重新进入时依赖下一次poll。状态事实上在server，协议却仍把浏览器当作定时重建者。

正确模型是server每次改变live run时主动发布authoritative state；连接同一Room的全部浏览器只消费该状态。WebSocket可靠有序地承载正常更新，连接建立时发送完整snapshot，HTTP GET只作为人工Debug fallback。

## 本地编辑与共享运行必须分层

同一用户可能在电脑上运行Macro，同时在手机查看或接管；也可能在一个标签页编辑另一个Macro。若把“当前选择的Macro”同步，会强行改动其他设备正在看的draft。若完全不共享Macro，又无法解释其他设备看到的active run。

因此必须同时存在两个互不覆盖的上下文：

* `Editing/Viewing Macro`：browser-local selector、draft、dirty、JSON mode和edit lease UI。
* `Running Macro`：Room server冻结的record identity、revision、definition和runner状态。

Save只发布record的新revision，不发布selector。Start后即使saved record再次更新或删除，active run仍使用启动时冻结snapshot；其他设备显示Running Macro，但不因此切换或覆盖本地editor。

## Runtime Input不是表单临时值

Input Action处于waiting时，当前prompt、default、已输入draft和提交状态决定run如何继续。若draft只在controller浏览器中，takeover后新设备看不到已输入内容；旧页面关闭后draft也消失。这与active run归server的模型冲突。

runtime input必须进入live server内存，并用revision防止快速输入、在途HTTP和takeover产生乱序覆盖。浏览器可以做即时显示，但每次authoritative确认和最终submit都来自server；它不写入MacroRecord，也不在restart后恢复。

## Disabled不是拒绝反馈

single-controller正确阻止observer写入，但大量HTML `disabled`控件会让点击完全没有事件。用户看到New Macro、New terminal、Prepare或Pause“没反应”，无法判断是只读、structure lock、content lease还是validation问题。

统一反馈必须覆盖client预检查和server拒绝，两者映射同一stable code/消息。保护draft的输入框仍可readonly/inert；明确的写操作控件需要保留可触发拒绝说明的交互，而不能只依赖disabled样式。

## Home与通知也必须服从同一哲学

Home registry属于server runtime，应在页面可见期间轻量自动读取，并在effect cleanup时停止；手动Refresh没有产品价值。Notify Action也只由server执行一次：Telegram是server-side side effect；App/System通过Room广播让当前在线浏览器各自呈现。浏览器不能互相转发，也不能在重连时把历史event重新弹一遍。
