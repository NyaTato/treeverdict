# Launch notes

The GitHub repository and v0.1.0 release are public. The English and Chinese launch films are release assets. The social platform copy in [`marketing/launch-copy.md`](../marketing/launch-copy.md) is a draft; no social posts have been made.

## Before any post

1. **The install line must be correct.** npm is not published yet, so posts must use the tarball command:
   `npm install -g https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-0.1.0.tgz`
   Do not write `npx treeverdict` anywhere until `docs/PUBLISH-npx.md` has actually been completed and verified.
2. **Use the published films:** [English MP4](https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-launch-en-1080x1920.mp4) · [Chinese MP4](https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-launch-zh-1080x1920.mp4). The README SVG and `npm run demo` provide a separate product demonstration.
3. **Keep every claim version-pinned.** The only cross-tool observation available is the `isitdone@0.8.2` ignored-file case, observed on Windows/Node 24 on 2026-10-16 and recorded in `docs/COMPARISON.md`. Quote it as such, with the no-superiority caveat attached. Do not extend it to other versions, platforms, or tools.

## Suggested sequencing

Rough ordering, not a schedule to execute on its own:

1. Chinese-language platforms first (B站 / 掘金 / 知乎), where the 15s clip and a short pain-point story carry the message.
2. Then English communities (X, r/ClaudeCode), each with the benchmark and repro links.
3. Show HN last, since it draws the most scrutiny and benefits from the fixes earlier posts surface.

Per-platform titles and captions are in [`marketing/launch-copy.md`](../marketing/launch-copy.md).

## House rules for any post

- Link the repo directly; let readers run `npm run demo` and `npm run benchmark` themselves.
- State the limitations up front (no same-user crypto protection, no sandbox) — they are in the README, and hiding them costs more trust than admitting them.
- Never ask for votes or coordinated upvotes.
- Answer technical criticism with the repro command, not with adjectives. If a claim cannot be reproduced, retract it in the thread.

## What to watch

If people click through but do not install, the install path or the demo is the problem — fix that before adding features. Tracked roughly: views → repo visits → installs → `check` runs → day-2 usage → issues.
