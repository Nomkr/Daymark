# 参与贡献 Daymark

感谢你愿意改进 Daymark。项目目前优先保证个人本地使用的稳定性，提交功能前请先说明实际使用场景和数据影响。

## 本地开发

需要 Node.js 20.19 或更高版本。在项目目录运行：

```powershell
npm.cmd install
npm.cmd run build
npm.cmd start
```

打开 `http://127.0.0.1:5173/`。本地记录位于 `data/`，该目录不会提交到仓库。

## 提交前检查

```powershell
npm.cmd test
```

桌面相关检查需要已经生成 `release/win-unpacked/Daymark.exe`。构建 Windows 安装包使用 `npm.cmd run package:win`。

## 提交规范

- 一个提交只解决一个清楚的问题。
- 不要提交 `data/`、`dist/`、`release/` 或个人截图。
- 涉及数据格式时，同时说明迁移和备份策略。
- 涉及界面时，检查桌面和窄屏布局，并补充必要的冒烟测试。
