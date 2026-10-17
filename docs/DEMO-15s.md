# 15-second demo — shot list

Goal: a viewer understands the point within three seconds. No architecture talk, no benchmark table.

**Rendered films:** [English MP4](https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-launch-en-1080x1920.mp4) · [Chinese MP4](https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-launch-zh-1080x1920.mp4). Both are 15 s, 1080×1920, 30 fps, with locally synthesized audio. They are GitHub Release assets; `assets/terminal-demo.svg` remains the in-repo visual.

## Reproducible CLI demo

```sh
$ treeverdict check      # PASS — this exact tree is green
# (an agent edits one line after the green run)
$ treeverdict status     # STALE — the old green no longer vouches for this code
$ treeverdict check      # PASS — green again, with a new receipt
```

The tree hashes are content-derived, so they differ per run and per machine. Never hard-code them: capture your own from `npm run demo`, which prints the real transcript and also writes it to `.treeverdict/demo-log.txt`.

## On-screen end card (one line)

> AI can say "done". Your code gets the final vote.

## How the launch film was made

1. Run `npm run demo` to see the same PASS → STALE → PASS product behavior.
2. The film was rendered from code and a real TreeVerdict fixture. Its displayed green and stale fingerprints came from actual CLI output; the ignored runtime file changed from `retries: 42` to `retries: 7`, and the subsequent test genuinely failed.
3. The film ends on STALE and the project URL. The CLI demo above shows how a fresh `check` can restore PASS after the code is fixed.

## Chinese voiceover (optional, for 抖音 / B站)

> Agent 说 Done 你就信了？我改了 gitignore 里的配置，它还在 PASS。treeverdict 直接变 STALE，并告诉你当初到底是哪段代码过的。20 个对抗用例全过，已开源求虐。

Title options and per-platform captions live in [`marketing/launch-copy.md`](../marketing/launch-copy.md).

## Release review

- [x] No absolute local path on screen
- [x] No competitor claims in the film
- [x] Actual CLI evidence for PASS, STALE, and the failed test after the edit
- [x] Both language cuts rendered, decoded, and visually reviewed
