# Execution Plan

## 阶段一：operation map

列出所有navigation/CRUD入口、await点、captured identity、lease transition和remote event outcome，补齐确定性race characterization。

## 阶段二：pure coordinators

先抽search projection、navigation decision和invalidation queue；Panel仍应用decision，确保输出等价。

## 阶段三：session迁移

逐步迁移list/selection/draft/lease/CRUD/preservation。每次只保留一个owner，并删除Panel内对应state/effect。

## 阶段四：收口

Panel只做view composition。扫描generic session、duplicate state、lost watermark和silent disabled，运行完整Library race Gate并记录结果。
