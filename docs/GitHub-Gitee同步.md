# GitHub 与 Gitee 同步

GitHub `CMMUU/mihomo-codex` 是代码和正式发行版的来源，Gitee `cmmuu/mihomo-codex` 保存对应副本。自 2026-09-04 起项目采用 GPL-3.0-only 开源，两站都应设为公开。先在 GitHub 完成测试、提交和发版，`Sync GitHub to Gitee` 工作流再复制全部分支、标签、已发布 Release 和原始附件。Gitee 同步不重新编译安装包。

## 自动触发

- GitHub 任意分支或标签 push。
- GitHub Release 发布或编辑。
- 同仓库 `Release bundles` 工作流成功完成；只接受 push 或手动运行，拒绝 fork 和 PR 工作流来源。
- 每天 UTC 02:17（北京时间 10:17）进行补偿同步，补齐附件后续上传、事件遗漏和暂时网络故障。
- Actions 页面手动运行 `Sync GitHub to Gitee`。

所有事件都执行完整同步。并发组只允许一个运行中的同步，等待任务即使被后来的事件替换，保留下来的任务仍会检查所有引用和全部已发布版本。工作流始终从可信 `main` 检出同步脚本，不执行上游构建产物或上游工作流提交中的脚本。

由 `GITHUB_TOKEN` 创建的 Release 通常不会再次触发另一个 `release` 工作流，因此保留成功构建后的 `workflow_run` 和每天的补偿入口。Release 应在完整附件上传后发布；单独上传附件不保证产生 `release: edited` 事件。不要同时启用会改动相同分支的反向镜像。

## 首次配置

1. 创建 Gitee 目标仓库，将 GitHub 与 Gitee 都设为公开，默认分支设为 `main`。空仓库不要额外初始化 README，以免引入分叉历史。
2. 在 GitHub 仓库的 Actions Secrets 配置 `GITEE_TOKEN`，赋予目标仓库 Git 推送、Release/附件写入及 `/user` 读取所需权限。身份必须是 `cmmuu`。GitHub 侧使用仅 `contents: read` 的内置 `GITHUB_TOKEN`。
3. 手动运行同步工作流，查看引用校验与每个版本的附件验证结果。离线测试通过不等同于远端同步成功。

脚本通过进程环境和 Git credential helper 的专用管道提供凭据，不把令牌写进远端 URL、命令行参数、Git 配置或日志。Gitee GET 使用 Bearer；写入依照 API 的 form 字段在内存请求体发送凭据。

以下 Actions Variables 可按已核实的目标配置填写；留空使用默认值：

| 变量 | 默认值 | 用途 |
| --- | --- | --- |
| `GITEE_ASSET_HOSTS` | 空 | 在内置 `foruda.gitee.com` 之外追加经核实的附件下载 CDN 精确主机名，逗号分隔，不支持通配符 |
| `GITEE_MAX_ASSET_BYTES` | `100000000` | 单附件上限，按社区版 100 MB 保守解释 |
| `GITEE_MAX_TOTAL_BYTES` | `1000000000` | 单仓库附件总上限，按社区版 1 GB 保守解释 |
| `GITEE_OTHER_ATTACHMENT_BYTES` | `0` | 普通仓库附件已占用或预留的字节数；新空仓库可使用零 |

Gitee 官方配额同时统计普通仓库附件与 Release 附件。同步器会枚举**所有 Gitee Release** 的已有附件，加上这次缺少的源附件和上述预留容量；同名已有附件不重复计数。Release API 无法列出普通仓库附件，因此维护者在增加普通附件后应更新预留值。预检不能代替服务端最终额度检查。仅在确认套餐已经提高配额后调整上限；脚本单附件技术上限为 512 MiB。

## 校验与失败恢复

- 在任何远端写入前检查身份与可见性；每次写入前再次核实仓库隐私。私有 GitHub 源不能同步到公开 Gitee 目标。
- 分支和标签仅使用原子、非强制推送，并读回校验 object ID。不删除目标多余引用、不强推分叉历史、不覆盖冲突标签。
- 先同步并校验代码引用，再检查全部 Release 附件单文件大小与预计总量。附件容量不足会阻止 Release 元数据和附件写入，但已同步的代码与标签保留；工作流仍报告失败，不能将此状态视为发版同步完成。
- 保留 Release 标题、正文与预发布标志；草稿跳过。写入后读回核对元数据。
- 原始附件先验证 GitHub 摘要；若含 `SHA256SUMS.txt`，它必须完整匹配该版全部附件。旧 GitHub 附件没有 digest 时，每次从 GitHub 重新下载，复用缓存时比较新旧内容，不能仅凭本地摘要信任缓存。
- 同名 Gitee 附件必须下载回验大小及 SHA-256。一致则复用，缺失才上传，冲突或重复则停止。目标独有的版本、附件和引用保留，不擅自清理。
- GET 请求的临时错误最多尝试三次。POST/PATCH 不盲目重试；上传结果不明时停止，下一次同步先查询已有附件，确认已上传就校验复用。可从 Actions 重跑失败任务，也会在下一次事件或每天补偿时再检查。
- 下载只接受 HTTPS 及获准的精确域名；发生跳转后不继续发送 Authorization，不记录签名 URL。未知 CDN 域名会导致同步停止，应核实来源后再配置。

Gitee Release API 没有与 GitHub 草稿等价的上传阶段，因此新版本的元数据创建后、全部附件回验前，页面可能短暂显示部分附件。以同步工作流成功为该版本复制完整的依据。失败不会删除 GitHub 版本或已验证的 Gitee 附件。

## 本地运行

环境需要 Python 3.10+ 与 Git。通过安全的进程环境注入 `GITHUB_TOKEN`、`GITEE_TOKEN`，不要在命令行中填写令牌。

```sh
python3 scripts/sync_gitee.py --repo mihomo-codex --scope all --work-dir /private/path/gitee-sync
python3 scripts/sync_gitee.py --repo mihomo-codex --scope all --work-dir /private/path/gitee-sync --apply
```

第一条仅进行身份、隐私和容量预检；第二条允许写入已经核实的目标。缓存可能包含私有代码和安装包，应使用私有目录。发现缓存或目标同名内容冲突时不要强行覆盖，应查明源资产是否被替换。

```sh
python3 -m unittest discover -s scripts -p 'test_sync_gitee.py' -v
```

离线测试不使用真实账号或凭据，覆盖隐私拒绝、引用范围、重定向脱敏、摘要、容量、无 digest 缓存、幂等和不确定上传恢复。

## 官方依据

- [Gitee API v5 规范](https://gitee.com/api/v5/doc_json)：按 5.4.92 核对 Release 创建/修改、附件列表/上传/下载；`AttachFile` 有 id/name/size，没有摘要字段。
- [Gitee 社区版配额](https://help.gitee.com/account/usage-quota)与[发行版创建及附件容量](https://help.gitee.com/repository/release/create)。
- [GitHub Actions 并发](https://docs.github.com/en/actions/concepts/workflows-and-actions/concurrency)与[工作流触发规则](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)。
