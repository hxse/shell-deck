# Problem Context

## 当前问题

factory前200行管理kind/search/list generation，随后约200行处理Select/New/Edit/Save/Cancel/Remove，后段又维护operation identity、lease release、published Save reconciliation和state install。现有三个coordinator已经证明transport、remote和identity可以独立，但command orchestration仍让factory超过700行。

## 拆分选择

list coordinator只拥有debounce/list request generation等非rune协调状态，通过live kind/query和install ports工作。edit orchestrator只编排lease/persist/delete阶段并返回outcome。既有`LibraryNavigationCoordinator`仍唯一冻结operation/controller/kind/selection/draft/revision/lease identity。

factory保留所有用户可见state和最终commit，因此不存在第二份item/draft/lease truth。

## 风险边界

切kind、selection与Cancel必须先序列化lease release并复核navigation identity。list/read只能覆盖clean readonly selection；dirty/editing/lost lease/preserved buffer只更新notice。Create已发布但lease失败时必须保留submitted buffer。
