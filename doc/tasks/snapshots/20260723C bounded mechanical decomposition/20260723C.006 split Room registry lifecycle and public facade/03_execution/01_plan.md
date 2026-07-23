# Execution Plan

## 阶段一：baseline

冻结manager export/public method inventory、creation path、summary和destroy event/order；扩展single facade/registry static test。

## 阶段二：抽registry read/create

移动ensure/create/list/summary/lookup/generation/capacity，manager通过thin delegation保持原sync surface。运行routing/capacity unit。

## 阶段三：抽destroy lifecycle

移动destroy single-flight和finish orchestration，以control/backend/client/map ports保持资源顺序。运行destroy race、real PTY drain和Home lifecycle。

## 阶段四：收口

删除manager duplicate registry helper，确认public consumer不变、无cycle且各文件不超过400行。运行Terminal/Room/runner focused与完整相关E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除manager中已迁移的private registry/lifecycle helper；保留全部public methods、re-export、map properties和cross-domain wiring。
