# Execution Plan

## 前置检查

确认`.001-.013`均已完成review、focused Gate，退役historical source已经删除，且全项目authored code没有401+文件。若仍有超限，回对应child修复，不在`.014`加临时豁免。

## 实现Gate

1. 新建小型deterministic scanner与focused unit。
2. 新增`just file-size`并接入`just check`。
3. 运行400/401、CRLF、root/nested multi-type discovery、non-project tree exclusion与filesystem failure tests。

## 整栈验证

按顺序运行file-size、check、build、unit、integration、E2E、diff-check；再运行source ownership、current journey、structured historical inventory、DOM structure与style oracle。检查summary中warning/skip/xfail异常。

## 文档与change closeout

同步active specs/`000_readme`，逐child写`04_review`并将index状态改为完成；root review汇总所有行数、module boundary和Gate结果。最后检查root、`.001-.014`及父`20260723B.004`全部`conflict=false`。

## Legacy Kill List

删除实现阶段临时line allowlist、debug output和旧大文件duplicate source；不保留任何authored-source exception。

## 停止线

完整Gate全部干净且无P1/P2后关闭root。新增feature、进一步风格偏好或小于等于400行文件的机械再拆不进入本task。
