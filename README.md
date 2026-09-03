# mihomo-codex

基于 Rust + Tauri 2 的轻量跨平台 Mihomo 客户端，目标平台为 macOS、Linux 和 Windows。

## 源码与下载

- 私有源码仓库：[CMMUU/mihomo-codex](https://github.com/CMMUU/mihomo-codex)
- 版本发布：[GitHub Releases](https://github.com/CMMUU/mihomo-codex/releases)
- 首版 `v0.3.1` 提供 macOS Apple Silicon（macOS 13+）安装包与 SHA-256 校验文件。
- Windows、Linux 和 Intel Mac 仍需对应平台的安装与网络接管验收；构建配置存在不等于已完成平台验证。
- 仓库及 Release 为私有，仅有仓库权限的账号可访问。本次没有为自研应用新增开源授权条款；第三方依赖沿用各自许可证。

## 设计文档

- [软件设计说明书（SDD）](docs/软件设计说明书.md)
- [架构与里程碑](docs/架构与里程碑.md)
- [0.3.1 更名与安装验证](docs/更名与安装验证.md)
- [v0.3.1 发布说明](docs/发布说明-v0.3.1.md)
- [0.3.0 运行验证记录](docs/运行验证记录.md)
- [Figma UI 设计源文件](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=8-2)
- [Figma 订阅管理界面](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=17-70)
- [Figma 节点详情弹窗](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=24-174)
- [Figma 应用内流量组件](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=27-3)
- [Figma 菜单栏流量组件](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=27-15)
- [Figma 应用图标设计](https://www.figma.com/design/aqVzL0f9upkr8BiYNCy2fu?node-id=12-3)
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
- 独立于 Mihomo 的 OS 全局实时流量监控，应用内和 macOS 菜单栏均显示纵向上下行速率
- 系统托盘、单实例和登录启动设置

## 更名与升级兼容

- 从 0.3.1 起，项目目录、应用名称和主可执行文件统一为 `mihomo-codex`。
- 保留 `com.cmmuu.mihomodesktop` bundle identifier、原用户数据目录及 TUN helper 服务标识，以复用订阅、设置和服务授权。
- 历史验证记录与 Figma 原始证据仍保留旧名称；更名不代表重新完成所有平台网络验收。
- 发布前运行 `npm run test:branding`，检查构建名称与兼容身份一致性。

## 开发环境

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
