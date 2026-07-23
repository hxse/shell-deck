# Problem Context

## 当前问题

create与reset各自包含相同的candidate backend模式：建立next runtime、缓存同步data/exit/error、`start()`、检查ticket、commit、标记running、发布snapshot/index，再flush callback。文件后段还包含CWD timer和`isCurrentTerminal` guard。

这些职责共享terminal object，但可以由显式lifecycle helper服务，不需要和input/Text/resize/resolve projection全部共处一个class。

## 拆分选择

backend lifecycle module负责“candidate尚未commit”和“callback只作用于current launch”的规则；CWD module只负责路径解析与timer。coordinator仍决定Room structure transaction、何时commit create/restart/close及消息顺序。

不让backend module直接拥有Room registry，也不让CWD module缓存cwd真值；它们始终操作coordinator取得的current `TerminalSlot`。

## 风险边界

candidate start失败必须close candidate且不修改Room。reset commit前先cancel old CWD、begin close old backend，再替换runtime；commit后pending callbacks按data、error、exit的既有次序应用。旧callback/timer发现terminal或launch已替换时必须无操作。
