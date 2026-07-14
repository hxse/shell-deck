# User Data Storage Contract

## User Data Root

解析优先级为显式 root、`SHELL_DECK_DATA_ROOT`、`XDG_DATA_HOME/shell-deck`、`$HOME/.local/share/shell-deck`。固定目录包含 `macros/`、`library/`、`runs/`、`agent-events/` 与 `.locks/`，notification config 为根目录下 `notification-profiles.json`。

POSIX 新建目录使用 `0700`，文件使用 `0600`；managed path 不接受 symlink。atomic replace 在 rename 前设置 mode 并 fsync file/directory。notification secret 文件权限过宽时 fail closed；其他已有 root 权限过宽至少 warning。

共享record的filesystem publish point是成功的`rename`或`unlink`。phase-aware primitive将此前错误作为未发布失败，将此后parent-directory fsync错误标为durability uncertain；record store在resource guard内重读核对exact intended bytes或确认path已不存在。核对成功必须返回authoritative success并由API广播，不得以失败响应诱导重复Create、revision-conflicting Update或phantom Delete。canonical SQLite transaction只充当advisory lock，成功operation之后的lock-release错误同样不能反转业务提交。需要保留迁移source的notification严格写入仍可拒绝uncertain durability。

## Shared content

`.032` 提供 user-global `MacroRecord<TDefinition>` envelope 与 canonical per-resource cross-process transaction primitive。record metadata（id/revision/timestamps）由 server 拥有；update/delete 必须匹配 expected revision。`.034` 已定义唯一MacroDefinitionV3并接入production CRUD/editor/runner；`.035` 在同一primitive上接入Library。

不扫描、转换或 dual-read 旧 config/project/directory 数据。唯一迁移例外是 notification config：从精确定义的 legacy path 在 target lock 内按 raw bytes relocation；内容相同才清理 source，内容冲突则两边都保留并 fail loudly。

## Content edit lease

saved Macro与Library record使用user-global、跨Room/process的per-record edit lease；Macro key为`(macro, tmpl_ id)`，Library key为`(library, itemKind, lib_ id)`。lease回答谁可以编辑，expected revision回答保存基线，两者缺一不可。不同record可以并行。

lease state位于`<user-root>/.locks/content-edit/`，只保存crash-expiring coordination state，不保存正文、不写Trace。acquire/takeover/renew/release与后继record update/delete都使用由同一canonical record path派生的`.032` transaction guard；OS lock只覆盖短事务，不覆盖整个编辑会话。owner server根据live Room WebSocket每10秒续期，TTL为30秒；Save只更新revision并保留当前Edit session/lease，显式Done/Cancel、切换或New其他内容、Delete、editor unmount、Room control丢失或Destroy才立即尽力release，process crash由TTL回收。New首次Create若继续编辑fresh record，必须随后取得其lease。leaseEpoch只在新owner取得或takeover时递增，release/expiry保留epoch并进入available，等待者不会自动晋升。

record atomic replace/unlink是正文commit的point-of-no-return。此前controller/lease/revision不匹配保证零写入；此后lease coordination文件刷新失败不能把已发布正文报告成失败。commit返回authoritative value与`retained/released/lost` lease outcome；`lost`时Save/Delete仍成功并必须广播，当前editor转只读且旧editLeaseId不可重用。

## Browser settings

panel visibility/width、Macro insertion placement、terminal drag toggle、notification volume与Library tab/filter使用一个strict versioned localStorage value。terminal Prepare是Macro面板显式Room mutation，不是setting，browser schema不包含`autoPrepareTerminals`或等价字段。current key/schema错误时直接reset defaults并提示；更早key不读取、不删除、不转换、不alias、不上传server。
