# Problem Context

current test suite已经覆盖复杂Macro UI、Library lease races、双标签Room runtime sync和runner fault injection，但四个文件各有数百行。大量场景共享setup与route interception，一旦修改单个race，审阅者难以判断是否影响其他journey。

测试拆分必须发生在production模块边界稳定后，否则代码和测试同时移动会失去基准。本任务最后执行，并用拆分前后的case inventory、用户step和assertion parity证明没有“为了好维护”丢掉困难场景。
