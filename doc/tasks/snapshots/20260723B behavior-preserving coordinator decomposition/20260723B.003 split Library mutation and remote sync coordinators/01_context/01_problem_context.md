# Problem Context

## Finding

`src/lib/library/librarySession.svelte.ts`为983行，约22个mutable state和43个nested function。factory既正确拥有Svelte rune truth，又直接实现API transport、fresh lease事务、published Save reconciliation、remote invalidation drain和reconnect retry；navigation、mutation和remote sync三个异步边界交织。

## 为什么现在处理

前序`.002`已经以Macro-specific workflow/coordinator验证“factory唯一state owner + 显式outcome/live ports”的边界。Library具有不同的kind/search/navigation/published Save contract，必须在独立change中做domain-specific拆分，避免演化成带feature flag的generic content session。

## Existing truth

* `LibraryNavigationCoordinator`已经冻结operation generation、controller epoch、kind/selection/draft/revision/lease identity，继续保留并由factory拥有。
* `LibraryInvalidationQueue`已经冻结sequence、ack/higher revision/delete分类与100/300/800ms retry。
* `library_contract.md`冻结browser-local protected buffer、fresh Create、cross-Room lease和reconnect行为。
* `.036` CRUD/navigation/races/reconnect browser suites是交互与quietly-wrong race oracle。
