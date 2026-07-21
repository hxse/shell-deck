# Problem Context

Macro/Library样式经过多轮精细UI调整，`base`与`cleanup`不仅表示新旧，而是共同构成当前cascade。文件名无法表达实际ownership，继续追加规则会让维护者难以判断改哪里、哪个覆盖生效。

本任务不能把`cleanup`当成可删除垃圾，也不能按字母排序selector。先用浏览器computed style和source-order inventory找到真正依赖，再按组件边界迁移；跨组件共享规则若拆开会改变cascade，应保留在最窄共同模块。
