# Execution Plan

## 阶段一：baseline

导出每个existing test的title/expect count和multi-issue exact arrays；记录validator dispatch与context/artifact flow。

## 阶段二：抽Action validator

移动Action及其专用message/filter helpers，保持同步调用；运行value/JSON multi-issue与Action focused tests。

## 阶段三：抽Control validator

移动Parallel/If/For/terminal control及recursive context；运行text-list/loop/Parallel artifact tests。

## 阶段四：拆unit test并收口

按case原样移动510行test并更新显式unit入口；验证pre/post title、expect和body evidence parity。确认源码/测试所有文件不超过400行，运行check/build/Macro unit/integration/E2E/diff-check，之后写`04_review`。

## Legacy Kill List

删除facade中已迁移的duplicate validator和旧test文件中的已移动case；不删除任何case、assertion、schema branch或issue。
