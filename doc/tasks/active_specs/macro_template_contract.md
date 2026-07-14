# Macro Foundation Contract

`.032` 只落地 user-global MacroRecord path/envelope/shared-store primitive，不注册临时 Macro schema、production CRUD、editor 或 runner API。旧 config-scoped Macro V2 route、store 和 UI 已不可达；该中间 revision 不是 standalone release。

`.034` 必须一次性定义并接回唯一 MacroDefinitionV3。冻结的后继边界是：definition 只保存连续 terminal index/type，不保存 configId、Room、server URL、cwd、terminalId、launchId 或 alias；Start 根据当前 Room index/type 解析 runtime terminalId 并冻结 run snapshot。

最终 Macro server surface 只有 list/create/read/update/delete。Copy 是 browser clipboard 操作；不存在 Duplicate、clone 或 copy-and-create route。current-schema-only 继续适用，不添加旧 V2 adapter、migration、dual validator 或隐藏 fallback。
