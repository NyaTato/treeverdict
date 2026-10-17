# Launch copy — titles and captions

Draft social copy only. **No social posts have been made.** The films are available on the [v0.1.0 release](https://github.com/NyaTato/treeverdict/releases/tag/v0.1.0).

Ground rules for every option below:

- The install command is the tarball URL, not `npx` (see `docs/PUBLISH-npx.md`).
- The only cross-tool fact available is the `isitdone@0.8.2` ignored-file observation, Windows/Node 24, 2026-10-16 — version-pinned, no superiority claim.
- The 15-second EN/ZH videos are published as release assets; use the appropriate language cut.

## Chinese titles (pick one)

1. AI说“搞定了”，我只改了一行代码
2. AI写代码最可怕的不是写错，而是它说自己写对了
3. 我做了个工具，专门检查AI有没有真的完成代码
4. AI说PASS，但代码已经变了
5. 当AI说Done，我让它拿证据出来

**Selected:** option 1 — *“AI说‘搞定了’，我只改了一行代码”*. The video shows the one-line edit and the resulting STALE verdict without making a claim about another tool.

## English titles (pick one)

1. AI said “DONE”. I changed one line.
2. Your AI agent passed the tests. Then the code changed.
3. AI can say done. Your code should prove it.
4. I built a tool that makes AI coding agents prove their work.
5. What does “all tests passed” actually prove?

**Selected:** option 1 — *“AI said ‘DONE’. I changed one line.”* It matches the 15-second film and creates a concrete question the footage answers. For Hacker News, use `Show HN: TreeVerdict — prove the exact code that passed`.

## Per-platform captions

**抖音 / Douyin** (with the 15s clip; keep the install line in the comments)
> Agent 说 Done 你就信了？改一行被忽略的配置，旧 PASS 立刻变 STALE。20 个对抗用例全过，开源。安装命令在评论区。

**B站 / Bilibili** (title + one-line description)
> 标题：AI说“搞定了”，我只改了一行代码
> 简介：treeverdict 把“通过”钉在具体那棵代码树上，改任何源码、测试或策略都会变 STALE。实测 20/20 对抗用例。15 秒演示 + 完整复现见仓库。

**X / Twitter** (≤280 chars)
> Your coding agent says "done". But which code passed?
> treeverdict hashes the tree before + after the test run and writes a receipt. Any edit after green → STALE.
> 20/20 adversarial cases. Zero deps, fully local.
> repo ↓ (no superiority claims; limitations in the README)

**Reddit — r/ClaudeCode** (must be detailed: what you built, how you used Claude, what you learned, logs/repro — otherwise it reads as spam)
> I built treeverdict because my agent kept saying "done" with no link to the exact code that passed. It runs the allowlisted tests without a shell, hashes the tree before and after, and writes a receipt. Re-running `status` recomputes the fingerprint: any source, test, or policy change since the green run returns STALE instead of vouching for the new code.
> What surprised me: `.gitignore` is irrelevant to whether a file can break your tests — a gitignored runtime config changed after green, `npm test` failed, and a pinned `isitdone@0.8.2` still reported PASS on that exact fixture (Windows/Node 24, 2026-10-16 — one version, one platform, not a claim it's better; it does hooks/HMAC better than this does).
> Repro: `npm run benchmark` (20 adversarial cases) and `node benchmark/compare-isitdone.mjs --run-competitor` (opt-in, pinned). No sandbox, no same-user crypto protection — both stated in the README.
> Feedback I actually want: where does STALE turn into a false positive for you?

**Hacker News — Show HN** (first comment, keep it plain and factual)
> Hi HN — treeverdict is a standalone verifier for "the agent said done".
> It runs the repo's allowlisted test command without a shell, hashes the in-scope tree before and after the run, and writes a receipt. `status` recomputes the hashes; any drift since the green run reports STALE rather than PASS.
> It refuses PASS without parsed runner evidence (exit 0 alone is NOT_PROVEN), BLOCKs on changed test baselines, and uses an unkeyed integrity hash — so it is tamper-evident against accidental edits, not cryptographically protected against the same user. No sandbox either.
> Try it: `npm run demo` and `npm run benchmark` (20 adversarial cases, 20/20).
> One version-pinned observation: on a fixture with a gitignored config file, after a 42→7 edit `npm test` fails but `isitdone@0.8.2` still reports PASS (Windows/Node 24, 2026-10-16); treeverdict goes STALE. That's one case on one version — not a superiority claim, and isitdone does hooks and keyed receipts better.
> Is the STALE false-positive rate a problem in real repos?

## Not to be used

- Anything implying treeverdict prevents a malicious same-user from forging a receipt.
- Any cross-tool comparison not pinned to an exact version and platform.
- Any reference to a GIF, or to `npx treeverdict` before npm publication is verified.
