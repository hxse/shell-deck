# Problem Context

当前validation文件同时处理JSON syntax位置、exact object、所有Action/Flow node结构、terminal/artifact scope、template/regex、persistable definition和runnable completeness。逻辑本身有明确层次，但集中在一个文件后，修改局部node容易碰到全局issue ordering。

这里最重要的不是减少行数，而是保留一个公开gateway，同时让内部依赖保持单向：node validator使用primitive/context，reference pass使用已经确认结构的definition，text parser调用public value validator。拆分不得让多个consumer各自拼装不同validation pipeline。
