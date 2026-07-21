# Problem Context

`App.svelte`现在既是route root，也是Room client coordinator。它处理Home自动刷新、WebSocket generations、controller takeover、terminal snapshots、runner delta gap repair、content invalidation、notifications和beforeunload。markup与异步状态机混在一起后，任何UI调整都需要审阅整个同步链。

本任务不把这些状态放进通用全局store。Room state只属于当前App实例/URL；抽取的runes module由App创建并显式销毁。这样仍满足同一server同步多个browser，而不会把browser-local selection/draft误共享。
