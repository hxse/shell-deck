# Execution Plan

## 阶段一：冻结phase

记录create/reset/close的candidate、commit、broadcast、callback和drain顺序，补同步callback与stale launch oracle。

## 阶段二：抽CWD lifecycle

移动resolve/create inheritance、schedule/refresh/cancel和current-terminal guard；运行cwd与real PTY focused tests。

## 阶段三：抽backend lifecycle

用显式candidate result/ports承接start buffering、current callback和close drain；coordinator保留commit调用。

## 阶段四：收口

清除duplicate buffering/CWD helper，确认无registry/cache/cycle且各文件不超过400行。运行terminal unit/integration、Room large replay/reset/CWD E2E、check/build/diff-check，之后写`04_review`。

## Legacy Kill List

删除迁移后的duplicate callback/CWD private method；保留public exports、backend factory、error和message contract。
