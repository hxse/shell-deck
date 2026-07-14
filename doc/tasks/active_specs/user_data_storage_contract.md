# User Data Storage Contract

## User Data Root

解析优先级为显式 root、`SHELL_DECK_DATA_ROOT`、`XDG_DATA_HOME/shell-deck`、`$HOME/.local/share/shell-deck`。固定目录包含 `macros/`、`library/`、`runs/`、`agent-events/` 与 `.locks/`，notification config 为根目录下 `notification-profiles.json`。

POSIX 新建目录使用 `0700`，文件使用 `0600`；managed path 不接受 symlink。atomic replace 在 rename 前设置 mode 并 fsync file/directory。notification secret 文件权限过宽时 fail closed；其他已有 root 权限过宽至少 warning。

共享record的filesystem publish point是成功的`rename`或`unlink`。phase-aware primitive将此前错误作为未发布失败，将此后parent-directory fsync错误标为durability uncertain；record store在resource guard内重读核对exact intended bytes或确认path已不存在。核对成功必须返回authoritative success并由API广播，不得以失败响应诱导重复Create、revision-conflicting Update或phantom Delete。canonical SQLite transaction只充当advisory lock，成功operation之后的lock-release错误同样不能反转业务提交。需要保留迁移source的notification严格写入仍可拒绝uncertain durability。

## Shared content

`.032` 提供 user-global `MacroRecord<TDefinition>` envelope 与 canonical per-resource cross-process transaction primitive。record metadata（id/revision/timestamps）由 server 拥有；update/delete 必须匹配 expected revision。`.034` 才定义唯一 MacroDefinitionV3 并接入 production CRUD/editor/runner；`.035` 在同一 primitive 上接入 Library。

不扫描、转换或 dual-read 旧 config/project/directory 数据。唯一迁移例外是 notification config：从精确定义的 legacy path 在 target lock 内按 raw bytes relocation；内容相同才清理 source，内容冲突则两边都保留并 fail loudly。

## Browser settings

panel visibility/width、Macro insertion placement、terminal drag toggle、notification volume与Library tab/filter使用一个strict versioned localStorage value。terminal Prepare是Macro面板显式Room mutation，不是setting，browser schema不包含`autoPrepareTerminals`或等价字段。current key/schema错误时直接reset defaults并提示；更早key不读取、不删除、不转换、不alias、不上传server。
