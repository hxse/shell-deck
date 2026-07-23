# Execution Plan

## 阶段一：生成不可丢失baseline

从`.012`父change记录每个current test title、expect/route/wait、step title、timeout/fault source及control inventory export/value；确认退役historical journey没有current discovery/runtime consumer。

## 阶段二：拆Room tests

按independent case移动large replay与saved-content spec，更新current journey file list和task recipes。先跑每个新spec，再跑合并inventory。

## 阶段三：拆Macro comprehensive

按ordered`test.step`抽helper，保留一个top-level journey。扩展inventory读取declared helpers并证明总数与顺序不下降。

## 阶段四：拆control inventory

把historical/current/evidence数组移入独立只读模块，原路径re-export。确认所有结构化export value/order不变；删除退役raw journey与hash-only oracle。

## 阶段五：收口

确认全部current-tree test/helper不超过400行且没有historical exception；运行full unit/E2E、current comprehensive、inventory、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除原大文件中已移动的duplicate case/data及退役raw historical journey；不删除任何current test、expect、step、fault或结构化inventory entry。
