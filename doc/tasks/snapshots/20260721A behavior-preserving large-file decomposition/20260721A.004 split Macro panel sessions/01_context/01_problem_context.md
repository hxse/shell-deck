# Problem Context

MacroPanel既是UI容器，也拥有四个不同生命周期：browser-local edit draft、user-global saved record/content lease、Room-scoped Prepare/active run，以及connection-scoped invalidation stream。这些状态刻意不同步，却集中在同一组件。

过去发现的竞态集中在operation pending期间：旧HTTP response覆盖新draft、takeover后旧lease复活、remote invalidation被提前消费、published Create buffer失去unload保护。拆分必须让每个await continuation携带完整identity snapshot，并由单一session owner决定能否commit。
