# Execution Plan

## 阶段一：cascade inventory

列出三个primary文件的selector、重复定义、media blocks、custom properties和加载顺序；采集固定环境computed styles与screenshots。

## 阶段二：机械迁移

按连续安全块逐步移动到目标模块，每移动一块保持声明与内部顺序，不做格式化或清理，并立即运行focused visual check。

## 阶段三：manifest收口

建立唯一import manifest，确认相同specificity覆盖顺序等价；删除旧重复implementation。

## 阶段四：验收

执行selector parity、computed style、pixel diff和完整UI journeys。review逐项声明零视觉变化，并记录任何保留在shared模块的跨域规则理由。
