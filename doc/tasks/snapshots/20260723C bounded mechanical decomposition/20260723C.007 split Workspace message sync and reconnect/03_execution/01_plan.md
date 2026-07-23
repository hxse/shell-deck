# Execution Plan

## 阶段一：baseline

冻结factory rune/return inventory、message-type commit map、connection reset顺序和timer/storage key；增加sole-rune-owner boundary test。

## 阶段二：抽message coordinator

按消息组移动control、terminal、runner、content、notification分支，通过live getter/commit ports保留原处理顺序。逐组跑projection unit。

## 阶段三：抽reconnect coordinator

移动close probe、retry timer、reload reclaim和dispose coordination；factory继续创建effect/client并写rune。

## 阶段四：收口

删除duplicate handler/timer helper，确认return/consumer/DOM不变、无state cache且各文件不超过400行。运行Room runtime/reconnect/takeover/current UI E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除factory中迁移后的duplicate message/reconnect helper；保留全部public return、browser storage key、notice/confirm与current protocol branch。
