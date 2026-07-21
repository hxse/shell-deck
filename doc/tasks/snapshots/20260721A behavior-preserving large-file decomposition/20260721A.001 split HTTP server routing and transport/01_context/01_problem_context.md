# Problem Context

`server/httpServer.ts`同时承担进程启动、HTML/assets、Room registry、terminal mutation、Macro/Library CRUD、runner API、controller authorization、WebSocket和错误映射。它已经成为多个独立transaction domain的共同编辑热点。

风险不在handler数量本身，而在这些handler共享关键ordering：route matching先后、request parse顺序、controller ticket获取与复核、record publish point、broadcast时点和Room destroy barrier。简单按URL切文件若复制guard或改变await位置，会产生行为漂移。

本任务因此采用“薄composition root + injected route groups”，不建立通用router abstraction。每个transaction仍由原service拥有，route只负责transport adaptation。
