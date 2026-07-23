# Problem Context

## 当前问题

文件前半主要验证Send/Input/Notify/Wait/Capture/Extract及matcher/message，后半验证Parallel lane、If/For和Break/Continue/Finish。唯一共享主线是`validateNode`按source order注册node ID、检查type/actionOnly，再调用具体validator。

测试文件同样把gateway、terminal layout、Action和Control场景集中在12个大case中。源码和测试都可按现有domain移动，但不能改变case本身或issue生成顺序。

## 拆分选择

`macroNodeValidation.ts`保留array traversal与dispatch；action/control module接收同一个`ValidationContext`并同步追加同一个issues array。共享的小型value validator可以留在facade或独立pure module，但不得建立第二个issue collection。

测试按case原样移动到core/action/control文件，public unit script显式包含所有新文件。

## 风险边界

ID validation必须先于unsupported type；exactKeys、field validator和recursive body的调用顺序必须原样。Parallel lane使用child/output context的artifact可见性不能因模块边界变成global或sibling共享。
