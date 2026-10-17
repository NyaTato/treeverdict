# treeverdict

[English](README.md) | [简体中文](README.zh-CN.md)

**AI 说“做完了”。treeverdict 证明“到底哪份代码通过了”。**

![终端演示：PASS 在一次编辑后变为 STALE，再在新树上 PASS](assets/terminal-demo.svg)

`treeverdict check` 不经过 shell 运行你的测试，在运行前后各哈希一次被覆盖的源码文件，并写出一份带（无密钥）完整性哈希的收据。`treeverdict status` 重新计算指纹 —— 自那次绿色运行之后，任何代码、测试或策略的变化都会返回 **STALE**，而不是让一句旧的“全部测试通过”为新代码背书。

> 英文版 [README.md](README.md) 是唯一事实来源（source of truth），中文版可能滞后。

## 安装

需要 Node.js ≥ 20。零运行时依赖。

```sh
npm install -g https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-0.1.0.tgz
treeverdict init --yes
treeverdict check
treeverdict status
```

该 release tarball 已从公开 URL 实测安装通过。**npm registry 上的包尚未发布**，因此现在请勿使用 `npx treeverdict`。也可以通过源码构建：`npm ci && npm run build`，然后使用 `node dist/cli.js`。发布流程见 [`docs/PUBLISH-npx.md`](./docs/PUBLISH-npx.md)。

## 为什么需要 treeverdict —— 一个可复现的缺口（2026-10-16 实测）

场景：一个 git 仓库，`.gitignore` 中忽略 `config.local.js`，`main.js` 引用它，`node --test` 断言其导出值为 42。

- 值为 42 时，`npx -y isitdone@0.8.2 --json` 返回 **PASS**。
- 仅把被忽略的运行时文件改成 7 之后，`npm test` **失败**，但 `npx -y isitdone@0.8.2 receipt --json` 仍返回 **PASS**，普通 `isitdone --json` 返回 `cached=true PASS`。
- 在同一场景下，当前 treeverdict 返回 **STALE**。

以上是 2026-10-16 的实测结果（Windows / Node 24），不是推断。它只针对 `isitdone@0.8.2` 这个特定版本，请勿推广到其未来版本。命名竞品对比同时承认：isitdone 在 hooks、HMAC 收据、更大的 tamper 语料方面做得更好。本文不声称 treeverdict 全局更强；这只是一个可复现的“被忽略文件”用例，说明为什么值得再引入一个独立验证器。

复现：基准用例 `ignored-runtime-input` 覆盖 treeverdict 这一侧，并在常规 CI 中运行（`npm run benchmark`，20/20）。固定版本的对照是 opt-in 的，永不进 CI：`node benchmark/compare-isitdone.mjs --run-competitor`（锁定 `isitdone@0.8.2`，仅在显式请求时通过 `npm exec` 安装并运行，绝不作为依赖添加）。本 README 中未实测的能力都标注为“未实测”。

## 15 秒演示

```sh
npm run demo
```

真实 transcript（同时保存到 `.treeverdict/demo-log.txt`）：

```
$ treeverdict init --yes      # 记录策略 + 测试基线（两者都要人工过目！）
$ treeverdict check           # PASS — tree ff05c9171089…，runner=node-test，passed=1 failed=0
$ treeverdict status          # PASS — 树与收据一致
$ echo '…' >> src/cart.js     # agent 在绿了之后“又顺手改了一行”…
$ treeverdict status          # STALE — 旧的绿不再为新代码背书
$ treeverdict check           # 在新树上 PASS，并写入新收据
```

观看 15 秒视频：[中文版](https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-launch-zh-1080x1920.mp4) · [英文版](https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-launch-en-1080x1920.mp4)。视频作为 GitHub Release 附件提供；仓库内保留上面的 SVG。[制作与复现说明](./docs/DEMO-15s.md)。

## 明确的局限（信任之前请先读）

- **同一用户伪造在密码学上不设防。** 收据携带的是无密钥完整性哈希（对收据正文做普通 SHA-256，不是签名/MAC），能发现误改或手改（`status` → `TAMPERED`），但有写权限的人只要重跑一次 `check` 就能生成合法收据。treeverdict 绑定“判定 ↔ 树”，它不替代签名、代码评审或可信 CI。见 [SECURITY.md](SECURITY.md)。
- **无沙箱。** 命令以你的身份、你的文件系统权限运行。一个恶意测试脚本可以做任何你能做的事。请像评审 CI 配置一样评审 `policy.json` 里的命令。
- **exit code 本身永远不等于 PASS。** 没有已知的测试运行器签名（vitest/jest/mocha/node --test TAP+spec/pytest/go/TAP）或人工评审过的 `successMarker`，绿色 exit 只会给出 **NOT_PROVEN**。`echo` 式命令与 shell 包裹命令在策略校验阶段就被拒绝；`package.json` 中可从 `npm test` 抵达的高置信度失败掩盖（`|| true`、`|| exit 0`、`; exit 0`、纯 echo 测试脚本、`--passWithNoTests`）直接 BLOCK，并给出可解释的原因。
- **测试基线更新不是安全边界。** `approve-tests` 信任的是人。旧收据会变 STALE，新基线只和你的评审一样可靠。新增、修改或删除测试文件一律 BLOCK，直到被批准。
- **软链接与不可读文件一律 fail-closed。** 逃出仓库根目录的链接会让检查失败；仓库内的链接只按目标字符串哈希，绝不跟随。无法读取的文件/目录（EACCES/EPERM/…）会让检查失败 —— 工具绝不静默跳过。遍历过程中瞬时消失的文件（ENOENT）会被跳过，不算作不可读。
- **按显式策略排除：** `.treeverdict/receipts`、`.git`、`node_modules`、`dist/build/coverage` 这类产物（完整列表见 `policy.json`）。其余一切 —— 包括 `.env` 这类被忽略的文件 —— 都会被哈希。所以指纹覆盖的是范围内源码文件，而不是字面意义上“磁盘上的每个字节”：标准构建产物与其他被排除路径属于设计上的范围之外。排除更多路径需要改策略，而这按设计会让旧收据变 STALE。

## 用法

```sh
treeverdict init [--yes] [--json]                 # 写 .treeverdict/policy.json + test-baseline.json
treeverdict check [--json]                        # 立即验证；写 .treeverdict/receipts/latest.json
treeverdict status [--json]                       # PASS | STALE | TAMPERED | FAIL | NOT_PROVEN | BLOCKED
treeverdict approve-tests -m "reason" [--json]    # 接受当前测试作为新基线
```

退出码：`0` PASS · `1` FAIL/NOT_PROVEN/STALE · `2` BLOCKED/误用 · `3` TAMPERED。

典型 Agent 工作流：`init` 一次（人工评审两个文件）→ agent 干活 → `check` → 把 `status --json` 贴进最终报告。评审者在本地重跑 `status`。

## Benchmark：20 个对抗用例

每个用例都是真实 fixture + 真实 CLI 运行（底线是“拒绝 PASS”而不是“假装 PASS”）：

```sh
npm run benchmark   # 20/20；在 Windows/Node 24 上实测约 14 秒（耗时因机器而异）；报告：.treeverdict/benchmark/results.json
```

核心用例 `ignored-runtime-input` 是上文那个具体缺口的第一方覆盖：只修改被忽略的运行时文件（`config.local.js` 42→7）之后真实 `node --test` 已经失败，此时必须返回 STALE。完整用例表见英文 [README.md](README.md#benchmark)。

## 国内平台

- 中英文标题备选与各平台短文案见 [`marketing/launch-copy.md`](./marketing/launch-copy.md)
- 15 秒分镜与口播见 [`docs/DEMO-15s.md`](./docs/DEMO-15s.md)
- 发布说明见 [`docs/LAUNCH.md`](./docs/LAUNCH.md)：社交平台文案仍为草稿，尚未发布

## License

MIT © 2026 NyaTato。见 [LICENSE](LICENSE)。
