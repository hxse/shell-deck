# Formal Contract

## 任务边界

允许新增`evidenceSegmentStorage.ts`与`evidenceRecordValidation.ts`（最终命名可在Document Gate内等价调整），并让`evidenceStore.ts`消费它们。`EvidenceStore`的export、constructor、method、type与constant surface保持不变；现有production consumer不得直接绕过Store写run evidence。

## 任务规范

### Segment storage

* layout保持`runs/<runId>/events/<12-digit-start>.jsonl`、`summary.json`与`artifacts/`。
* segment size仍为100，retention仍为1000；first retained sequence公式不变。
* read与append前先截断不完整final line，并对managed regular file/private mode执行原检查。
* append必须保持write-complete、file fsync、after-publish hook及new-entry directory fsync顺序。
* complete line之后的fsync/close/hook/directory错误继续报告published-but-uncertain；不得回滚完整line。
* prune只有在delete receipt uncertain且path仍存在时抛`evidence_segment_prune_state_unknown`。

### Record validation

* event与summary exact key set、schemaVersion、generated ID、Room token、ISO timestamp、sequence/count invariant不变。
* 所有既有error string保持，包括`invalid_evidence_event`、`invalid_evidence_summary`、`invalid_evidence_event_sequence`与provenance相关错误。
* validation是纯函数，不读写filesystem、不维护cursor。

### Public store

* store唯一拥有append cursor与maintenance debt。
* publish仍先核对persisted event intent，再执行prune与summary checkpoint；maintenance失败只登记debt。
* existing event的idempotent append、sequence conflict、summary recovery、artifact append event与run collision retry保持。
* 依赖只能是Store -> segment/validation；底层模块不得反向import Store。

## 示例

正例：第101个event完整写入新segment，file fsync成功但directory fsync失败。append仍可从segment读回同一event，caller得到已发布结果；maintenance可稍后修复，不能让runner重复同一sequence。

失败例：JSON只写了一半时进程中断。下次read/append先截到最后一个换行，再继续原sequence；半行不能被codec当成损坏的完整event。

反例：把summary write放到event append之前，或让validation module自行删除旧segment，均改变publish/ownership顺序，必须阻断。

## 测试

* 保留`evidenceStore032.test.ts`对目录、append、read、artifact和错误的覆盖。
* 保留`macroRunStore034.test.ts`与`macroRuntime034.durability.test.ts`对post-publish uncertain、summary recovery和terminal event的覆盖。
* 增加module boundary：public consumer只经`evidenceStore.ts`/`MacroRunStore`，底层无反向依赖。
* focused Gate需覆盖partial line、idempotent retry、sequence conflict、retention prune、maintenance debt与exact codec。
* 正式Gate：`just check`、production build、focused unit/integration、`just diff-check`；本轮未执行。
