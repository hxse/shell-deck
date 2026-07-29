# AI pre-review

## 总体判断

用户已经冻结默认fail、统一pane缩进线、短Prepare标签和带确认Close all四项产品选择。spec把Close all限定为一个exact、controller-guarded、serialized、batched projection命令，没有扩大为Room清理或持久化删除；Document Gate与Execution Gate可以通过并进入实现。

## Findings and Solutions

最主要风险是前端逐个发送close导致controller变化、structure lock或连接中断时留下silent partial deck。计划明确禁止这种实现，改为一次ClientMessage，在server structure queue内冻结id并复用既有close lifecycle；若异常则通过既有terminal error fail loudly。

第二个风险是为了缩进线引入Parallel专用CSS并造成Theme分叉。spec要求直接消费Flow已有的`depth + 1`和semantic utility，不新增style ownership。

## 需要人工拍板

无。用户已明确按钮要确认、Close all覆盖Shell和Text、On pane fail默认fail，并要求直接实现。

## AI 可直接修

按`03_execution/01_plan.md`实现代码、测试、current docs与focused入口。

## 未覆盖与残余风险

尚未修改代码或运行Code/Test Gate。批量terminal close不提供rollback；这是现有live backend close不可逆语义，必须以serialized execution、最终projection和fail loudly约束，而不是伪造事务回滚。
