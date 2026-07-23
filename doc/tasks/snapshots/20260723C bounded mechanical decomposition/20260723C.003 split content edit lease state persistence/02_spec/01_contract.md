# Formal Contract

## 任务边界

允许新增`contentEditLeaseStateStore.ts`或等价单一模块；`ContentEditLeaseService`及其public option/result types、constant和method不变。state store是private dependency，不得被HTTP/Macro/Library直接消费。

## 任务规范

### State persistence与codec

* state path仍由canonical resource relative path做SHA-256，位于`.locks/content-edit/<digest>.json`。
* available/held schemaVersion 1的exact key set、ISO时间、epoch/revision和resource identity校验不变。
* missing state返回epoch 0 available；expired held转换为同epoch available并持久化。
* write仍为private atomic JSON加末尾换行；delete忽略ENOENT并fsync lease directory。
* record revision仍从canonical record JSON exact读取；missing/invalid/error string不变。
* state store不维护Room context、owned lease map或onChanged callback。

### Business transaction

* service唯一维护`owned` map并验证same control context。
* Acquire/Takeover/Release/Renew顺序、transaction signal和广播时点不变。
* Commit在同一canonical resource guard内依次验证authorization、tracked ownership、held state、expected revision，再次authorization后调用同步operation。
* operation返回Promise继续fail loudly为`content_commit_operation_must_be_sync`。
* non-delete commit必须看到revision精确`+1`；state refresh失败清owned并返回lost outcome，但durable value仍成功。
* delete commit在record operation后释放owned；state cleanup失败返回lost outcome，不能反转value。

## 示例

正例：Macro update已原子写入revision 8，随后held state写失败。service返回saved value和`content_edit_lease_state_refresh_failed` lost outcome，UI转read-only；不能返回HTTP失败诱导重复update。

失败例：lease state文件resource key与requested key不同，codec抛`content_edit_lease_resource_mismatch`；不得当作available或自动覆盖。

反例：state store直接调用`ticket.assertAuthorized()`或广播lease view，说明业务边界下沉过度。

## 测试

* `contentEditLease033.test.ts`冻结epoch、takeover、TTL、published commit与disconnect。
* `contentEditLeaseProcess033.test.ts`冻结跨process exclusion。
* Macro/Library HTTP integration冻结commit/lease/revision组合。
* 增加codec/path/state-store unit和service-only consumer boundary。
* 正式Gate：`just check`、build、focused unit/integration及saved-content E2E、`just diff-check`；本轮未执行。
