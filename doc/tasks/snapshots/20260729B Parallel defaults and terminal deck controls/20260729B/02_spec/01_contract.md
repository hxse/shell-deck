# Parallel defaults and terminal deck controls contract

## 任务边界

本任务不修改MacroDefinitionV6 shape。`onLaneFail`继续是必填的`"pause" | "fail"`；只改变Visual editor新建Parallel时写入的显式默认值。旧saved record、Paste/JSON输入和正在运行的frozen definition逐值保留，不迁移、不补写。

Close all只作用于当前live Room terminal deck。它不关闭Room，不删除user-global Macro、run log、artifact或evidence，也不增加旧protocol兼容分支。

## 任务规范

### Parallel默认值与层级表现

`defaultFlowNode("parallel", ...)`必须生成：

```json
{
  "type": "parallel",
  "sharedTextOrder": "pane_order",
  "onLaneFail": "fail",
  "lanes": [{ "id": "lane_1", "label": "lane_1", "body": [] }]
}
```

On pane fail selector仍同时提供`pause`和`fail`，用户可以显式改为pause。

selected pane复用递归Flow body的层级语言：`border-l-4`加`pl-2`，颜色按pane所在的`depth + 1`在`primary / secondary / accent / info`间轮换。实现只使用现有daisyUI semantic color与static Tailwind utility，不增加Parallel专用CSS selector，不用固定hex颜色。pane tab、字段、Action顺序与mutation gateway不变。

### Run dock controls

现有`macro-prepare-terminals` control identity、title、disabled规则与Prepare行为保持；可见idle标签从`Prepare terminals`缩短为`Prepare`，pending标签仍是`Preparing…`。

新增`macro-close-all-terminals`按钮，显示`Close all`，与Prepare相邻并使用theme-native destructive button样式。以下任一条件成立时disabled：

* browser不是当前Room controller或连接不可写；
* terminal structure因active run等原因被锁；
* 当前Room没有Shell/Text terminal。

点击enabled按钮必须显示native确认：

`Close all Shell and Text tabs in this Room?`

Cancel不发送消息、不改变terminal。Confirm只发送一次exact `{ "type": "close_all_terminals" }`。

### Server mutation

`close_all_terminals`是exact ClientMessage，不接受额外字段或terminal selector。它必须走与create/reorder/close/reset相同的controller operation和terminal structure serialization。

在serialized mutation内先冻结当前terminal id顺序，再复用既有单terminal close lifecycle关闭每一个Shell/Text。所有中间`terminal_index_map`必须由既有batch projection合并，只向client发布最后一份authoritative map；空deck是成功no-op。出现异常必须fail loudly，不得把未完成批次报告成成功。active run的server-side structure lock继续拒绝该命令。

## 示例

Room当前包含`Shell 1`、`Text 2`与`Shell 3`。controller点击`Close all`：

1. browser显示确认框；
2. Cancel后三个tab保持不变；
3. 再次点击并Confirm后只发送一个`close_all_terminals`；
4. server在同一structure operation内关闭三个backend/runtime slot；
5. observer与controller最终都收到空的authoritative terminal index map。

observer看到disabled按钮，不能靠手工构造消息越过server controller guard。active Macro run期间按钮disabled，手工构造消息仍被server structure lock拒绝。

## 测试

Code/Test Gate至少覆盖：

* default factory和Visual insertion产生`onLaneFail:"fail"`，selector仍可切换pause；
* saved/current explicit pause不被改写；
* root与nested Parallel pane的rail使用`depth + 1` semantic color，没有新增style block或专用CSS；
* Prepare control id/行为不变且显示短标签；
* protocol exact parse接受Close all，拒绝额外字段；
* controller Confirm一次关闭mixed Shell/Text，Cancel不变，observer与structure lock均不能mutation；
* batch只发布最终index map，backend close沿用既有lifecycle；
* current control/structure/theme inventory与完整Macro/Room回归通过。

focused入口为`just test-20260729b`。Close Gate严格串行执行`just check`、`just build`、`just test-unit`、`just test-integration`、`just test-20260729b`、`just test-e2e`与`just diff-check`。任何warning/error、P1/P2、conflict或超过400行的project-authored code都阻断完成。
