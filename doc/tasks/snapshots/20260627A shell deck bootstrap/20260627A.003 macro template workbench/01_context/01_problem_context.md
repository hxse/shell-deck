# Problem Context

用户希望宏模板像可定制 AHK 脚本一样灵活，但底层 JSON 不能强迫用户手写。V0 需要让用户在侧面板完成基本增删查改，并能导入、导出、复制和备份模板。

模板不能保存 Codex session。它只描述“在当前 config 下对哪个 terminal ref 做什么动作，以及使用哪个 capture source”，这样用户才能随时换 terminal、退出 Codex、改跑 shell command，或者把同一模板复用到另一个 deck。
