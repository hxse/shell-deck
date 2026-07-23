# Execution Plan

## 阶段一：冻结交互图

记录connect/pong/sweep/disconnect到controller transition的callback图、message order和hook次数，补single-map/module boundary test。

## 阶段二：抽lease coordinator

移动owner/view/grant/epoch/ticket与takeover transaction；先让原coordinator的presence methods通过ports调用它。运行controller与content lease unit。

## 阶段三：抽presence coordinator

移动client identity、map mutation、ping/pong/sweep。原facade装配两个module并保持method surface。

## 阶段四：收口

删除重复transition，确认无cycle、无state cache且所有文件不超过400行。运行Room control/WebSocket/single-writer/takeover E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除facade中已迁移的private presence/lease helper；保留全部export、constant、message/error和hook entry。
