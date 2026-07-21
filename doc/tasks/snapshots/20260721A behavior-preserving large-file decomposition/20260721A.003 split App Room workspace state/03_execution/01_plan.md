# Execution Plan

## 阶段一：state inventory

标记App内每个state的owner、server/browser-local属性、更新来源、generation guard和cleanup。先补dispose/reconnect/dirty aggregation characterization。

## 阶段二：pure coordinators

先移动runner repair decision与notification delivery；保持App调用点和时序，避免同时移动markup与socket lifecycle。

## 阶段三：Room state与Home

1. 建立per-App room state实例，逐类迁移socket/controller/terminal/runner projection。
2. 每迁移一类就删除App内旧state/effect。
3. 抽Home组件，保持原DOM与Svelte 5 refresh lifecycle。

## 阶段四：收口

App只保留route/composition/dirty guard。扫描singleton、duplicate effect、未dispose listener与DOM drift，运行完整Gate并记录双标签证据。
