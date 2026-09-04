# RouteDeck 0.6.0 更名验证

日期：2026-09-04。范围：本机 Windows x64 与项目命名，不是六平台正式发行或代理接管验收。

## 已完成

- 显示名称为 RouteDeck；仓库、npm/Cargo 包、主程序标识为 `routedeck`，Rust 库为 `routedeck_lib`。
- GitHub 原仓库原地更名为 `CMMUU/routedeck`，仓库 ID `1355770287` 不变。
- Gitee 原仓库原地更名为 `cmmuu/routedeck`，显示名 RouteDeck，仓库 ID `50078322` 不变；保持公开及旧发行版。两站 Git remote 已更新。
- 应用 identifier、数据目录、helper 标识和旧规则元数据前缀保持不变；没有转换订阅或配置内容。

## 本机安装核对

1. 备份旧 0.5.0 安装目录和现存应用数据，核对旧程序与备份 SHA-256 相同。
2. 在旧客户端未运行时，静默卸载旧 NSIS 安装，不选择删除应用数据；退出码为 0，旧卸载项及程序文件已移除，应用数据仍存在。
3. 从当前源码构建并安装 `RouteDeck_0.6.0_x64-setup.exe` 到 `%LOCALAPPDATA%\Programs\RouteDeck`；安装退出码为 0。
4. Windows 卸载项显示 RouteDeck 0.6.0；主程序为 `routedeck.exe`，文件版本及产品名称一致；开始菜单存在 `RouteDeck.lnk`。
5. 未启用登录启动，未启动 RouteDeck 接管网络。原 Clash Verge 进程及内核保持运行，系统代理仍为 `127.0.0.1:7897`。

Tauri 安装包会将主程序的 bundle-type 标记由 `UNK` 改为 `NSS`。安装后的主程序与构建目录主程序仅有此 3 字节差异，其他字节一致。

安装包 SHA-256：`c991c2ce51788ef2e32c425e03c20d40adeb4ba40711966d26cbcdd7cbafcb89`。

## 自动化检查

| 检查 | 结果 |
| --- | --- |
| 品牌、版本与保留兼容标识 | 通过 |
| 应用及 Mihomo 许可证 | 通过 |
| 前端主题测试 | 15 通过 |
| 前端规则测试 | 19 通过 |
| TypeScript / Vite 生产构建 | 通过 |
| Rust 测试 | 77 通过，2 个显式外部环境测试跳过 |
| Rustfmt、Clippy `-D warnings` | 通过 |
| 发布器与 Gitee 同步器离线测试 | 54 通过 |
| v0.6.0 SBOM / 许可证清单 | 614 项依赖生成并通过合规校验 |
| Windows x64 NSIS 构建 | 通过 |

## 边界

- 安装项与二进制核对不等于界面交互、真实订阅读取或网络功能验收；本次未执行系统代理/TUN 切换。
- 本次没有发布 v0.6.0 标签或正式 Release，历史版本与附件保持原样。
- macOS、Linux、Windows ARM64、MSI 迁移仍需单独验证；具体迁移风险见 [v0.6.0 发布说明草稿](发布说明-v0.6.0.md)。
