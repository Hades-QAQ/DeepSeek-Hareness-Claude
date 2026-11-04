# DeepSeek Hareness Claude

Windows 上的 DeepSeek Harness 第三方插件。在 DSH 左侧选择本地文件夹，使用 SSH 在 Linux 服务器运行 Claude Code，保留原生终端交互。当前 v0.2.1 是终端版，DSH 左侧原生模型选择和消息流接入属于后续版本。

## 安装与使用

1. 本地准备 Windows 版 DSH、Node.js、Git 和 OpenSSH。已在 DSH 0.2.1-rc.5 桌面构建上开发。远端用户需要能运行 tmux、Git 和已登录的 claude。
2. 在 DSH 插件管理页添加此仓库并启用插件。默认使用 Windows 桌面 profile 的 ~/.dsh/profiles/desktop；自定义 profile 路径需要调整 client.js 中的 bridgePath。
3. 点击左侧「＋ 添加 Claude 工作区」，选择本地项目目录，填写自己的 SSH 主机（user@host 或 SSH 别名）。私钥只需指定本机路径。
4. 「接入 Claude」和「服务器 Terminal」分别连接工作区对应的 tmux 会话。再次选择同一主机和工作区可接回仍在运行的会话。
5. Git 同步只传递已提交的分支，使用前先检查并提交修改。剪贴板图片通过 SSH 上传到同一用户的远程附件目录，路径插入 Claude 后手动确认发送。

已在 Windows DSH 内验证 SSH 连接、远端 Claude Code 启动和命令菜单显示。Git 双向同步、图片上传及从全新配置安装的完整流程尚未完成端到端验证。
