# Execution Plan

## 阶段一：冻结transaction

记录每个public method的authorization、guard、state read/write、owned map和broadcast顺序；冻结全部error/outcome。

## 阶段二：抽codec与path

移动state type/validator、view/grant projection、state path与record revision reader。先运行invalid state、resource mismatch、missing/expired state测试。

## 阶段三：抽filesystem persistence

让service在原transaction callback内调用state store；write/delete injection继续从public options进入同一failure point。验证published update/delete fault。

## 阶段四：收口

删除service重复private helpers，确认service仍唯一拥有authorization/owned map且各文件不超过400行。运行content lease、Macro/Library HTTP/process/E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除迁移后的duplicate codec/path/filesystem helper；不删除current schema、public option injection、error或transaction guard。
