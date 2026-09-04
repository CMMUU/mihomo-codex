# mihomo-codex

基于 Rust + Tauri 2 的轻量跨平台 Mihomo 客户端，目标平台为 macOS、Linux 和 Windows。

## 源码与下载

- 私有源码仓库：[CMMUU/mihomo-codex](https://github.com/CMMUU/mihomo-codex)
- 版本发布：[GitHub Releases](https://github.com/CMMUU/mihomo-codex/releases)
- 当前版本 [v0.5.0](https://github.com/CMMUU/mihomo-codex/releases/tag/v0.5.0) 改进 Windows 权限提示、内核进程回收、系统代理恢复与连通性诊断；安装包和 SHA-256 校验文件以 Release 页面实际附件为准。
- Windows 10/11 TUN 为实验性功能，已实现管理员会话运行方式，尚未完成真实 TUN 路由与恢复验收。各平台的安装、构建和网络接管验证范围见 [v0.5.0 发布说明](docs/发布说明-v0.5.0.md)。
- 仓库及 Release 为私有，仅有仓库权限的账号可访问。本次没有为自研应用新增开源授权条款；第三方依赖沿用各自许可证。

## 设计文档

- [软件设计说明书（SDD）](docs/软件设计说明书.md)
- [架构与里程碑](docs/架构与里程碑.md)
- [v0.5.0 发布说明](docs/发布说明-v0.5.0.md)
- [v0.4.0 发布说明](docs/发布说明-v0.4.0.md)
- [规则管理与升级验证](docs/规则管理与升级验证.md)
- [当前应用图标](assets/brand/图标说明.md)
- [v0.3.2 发布说明](docs/发布说明-v0.3.2.md)
- [0.3.1 更名与安装验证](docs/更名与安装验证.md)
- [v0.3.1 发布说明](docs/发布说明-v0.3.1.md)
- [0.3.0 运行验证记录](docs/运行验证记录.md)
- [Figma UI 设计源文件](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=8-2)
- [Figma 订阅管理界面](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=17-70)
- [Figma 节点详情弹窗](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=24-174)
- [Figma 应用内流量组件](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=27-3)
- [Figma 菜单栏流量组件](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=27-15)
- [历史 Figma 应用图标设计（0.3.x）](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=12-3)
- [更新日志](CHANGELOG.md)

## 当前范围

- Clash Meta / Mihomo YAML 订阅和本地文件
- 原始配置与本机控制字段合并
- Mihomo 原生配置校验
- UUID 配置档案、不可变版本、激活和回滚
- 固定版本 Mihomo sidecar 下载、SHA-256 校验和跨平台打包
- Mihomo 生命周期、状态机、端口预检和脱敏日志
- Manual、System Proxy 和 TUN 网络模式
- 代理组、节点切换、延迟、规则、连接和关闭连接
- 独立订阅管理：摘要、刷新、激活、版本、删除、脱敏来源和导入
- 当前节点详情：实际代理链、Provider、脱敏服务器、协议与健康历史
- OpenAI 自动灾备：独立检测、最多 10 个节点、带宽排序、自动切换和订阅更新后维护
- 分层连通性诊断
- System Proxy 接管前后安全预检、活动物理网卡筛选和失败自动恢复
- Windows 系统代理事务恢复、外部客户端接管识别，以及 PAC／代理例外保留
- Windows 10/11 实验性 TUN 管理员会话，核心进程树随停止或退出回收
- 独立于 Mihomo 的 OS 全局实时流量监控，应用内和 macOS 菜单栏均显示纵向上下行速率
- 系统托盘、单实例和登录启动设置
- 独立浅色、深色、深紫与跟随系统外观，点击立即生效并保存，不触发代理接管
- 可视化全局规则管理：增删改、启停、上下排序、备注、草稿校验与热更新
- 高级规则文本导入与可复制导出、独立持久化、最近 20 个历史版本与校验后回滚

## 自定义规则

1. 打开「规则 → 我的规则」，添加匹配条件，选择 `DIRECT`、`REJECT` 或当前配置中的策略。
2. 使用上移／下移调整优先级；未启用的规则保留在编辑器中，但不加入内核配置。
3. 点击「校验草稿」，通过后「保存并应用」。运行中的内核热更新，不先停止代理进程。
4. 「高级文本」接受逐行规则、YAML 列表或仅含 `rules:` 的 YAML；「导出文本」提供只读文本与复制入口，由用户自行保存文件。
5. 在「历史版本与回滚」选择版本并确认。回滚也会校验并生成新版本。

全局用户规则优先于托管 AI 与订阅规则，更新订阅不会覆盖它们。`DIRECT` 表示进入 Mihomo 的连接从本机直连出口，并非修改系统代理例外列表；不使用系统代理的程序原有直连行为保持不变。规则分流应使用 `Rule` 路由模式。

导出中的 `mihomo-codex-rule` 注释用于本应用恢复启停、备注与顺序。导出内容是规则编辑数据，不是完整代理配置；交给其他客户端前需按其规则格式处理停用条目。

## 更名与升级兼容

- 从 0.3.1 起，项目目录、应用名称和主可执行文件统一为 `mihomo-codex`。
- 保留 `com.cmmuu.mihomodesktop` bundle identifier、原用户数据目录及 TUN helper 服务标识，以复用订阅、设置和服务授权。
- 历史验证记录与 Figma 原始证据仍保留旧名称；更名不代表重新完成所有平台网络验收。
- 发布前运行 `npm run test:branding`，检查构建名称与兼容身份一致性。

## Windows 使用说明

- Windows TUN 使用管理员会话：先从托盘退出应用，再右键选择「以管理员身份运行」。整个应用会获得管理员权限，不安装常驻 Windows 服务，也不使用 macOS Helper 的安装/授权流程。普通系统代理不要求管理员会话。
- Windows 内核、配置校验和版本探测进程在创建时绑定 Job；停止、退出或应用进程异常终止会关闭受保护的进程树。关闭主窗口仅隐藏到托盘。系统代理在正常停止/退出时按快照恢复，异常终止后在下次启动尝试恢复。
- 系统代理恢复会核对当前代理是否仍由本应用控制，避免覆盖后来切回的 Clash 等客户端；临时接管会保留代理例外、停用 PAC，并在仍持有控制权时还原原有 PAC。切换前应关闭其他客户端的系统代理/TUN。
- 启动预检以 Google/Cloudflare 至少一个返回预期状态为基础联网条件；OpenAI 仍独立检查并显示警告，专项失败不会阻止基础代理启动。两个基础目标都失败时仍会阻止启动。

**Windows TUN 为实验性功能。** 已实现管理员权限检测和会话内核生命周期；真实 TUN 路由、DNS、停止后的网络恢复及异常退出恢复尚未完成整体验收。单元测试、界面模拟检查和构建成功不代表已通过网络接管验收。

## 开发环境

Windows 10/11 x64/ARM64 使用对应 MSVC 工具链；需要 Microsoft C++ Build Tools、Windows SDK、Node.js/npm 和 WebView2。`npm run core:prepare` 按 Rust host target 下载内核，GNU target 不在当前内核清单中。

```bash
npm install
npm run tauri dev
```

`npm run tauri dev` 会根据 `src-tauri/core-manifest.json` 自动下载并校验当前平台的 Mihomo sidecar。

准备全部目标平台核心：

```bash
npm run core:prepare:all
```

Mihomo 运行时会先执行 `mihomo -t -d <data> -f <config>` 配置检查，检查通过后才启动内核。

## 验证

```bash
npm run test:branding
npm run test:licenses
npm run test:theme
npm run test:rules
npm run build
npm run test:rust
cargo check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
```

## 发布架构

Tauri sidecar 为各目标平台提供匹配的 Mihomo 二进制：

```text
src-tauri/binaries/mihomo-<target-triple>
```

构建脚本校验固定压缩资产的 SHA-256，并验证当前平台的 `mihomo -v` 输出。CI 在 macOS、Windows 和 Linux 原生 runner 执行。

推送稳定版本标签 `vX.Y.Z` 后，`Release bundles` 在六个平台全部构建成功后自动创建 GitHub Release。标签必须与 `package.json`、Tauri 和 Cargo 版本一致，并提交对应的 `docs/发布说明-vX.Y.Z.md`。发布作业收齐 12 个安装包，附带匹配的 Mihomo GPL 许可证、上游源码和 `SHA256SUMS.txt`；附件上传及 SHA-256 校验全部通过后才公开草稿。重复运行会复用内容相同的附件，遇到同名不同内容则停止，不覆盖原发布包。手动 `workflow_dispatch` 只构建并保留 Actions artifacts，不创建发行版。
