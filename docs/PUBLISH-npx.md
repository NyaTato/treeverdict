# npm publish checklist (maintainer only)

Status 2026-10-17: **not published.** `treeverdict` does not resolve on the npm registry, so `npx treeverdict` does **not** work yet. The current verified install is the release tarball:

```sh
npm install -g https://github.com/NyaTato/treeverdict/releases/download/v0.1.0/treeverdict-0.1.0.tgz
```

The package is already shaped for a global/npx install: `bin.treeverdict` → `dist/cli.js`, `files` limited to `dist` + docs, zero runtime dependencies, `engines.node >= 20`, `prepack` builds `dist`.

## Steps

Run in order, manually, from a clean checkout at the release commit.

1. **Log in manually.** Run `npm login` yourself in an interactive terminal. Never paste a token into a file, a script, or a chat.
2. **Dry run.** `npm publish --dry-run --access public` — confirm the packed file list contains only `dist/`, `README.md`, `README.zh-CN.md`, `LICENSE`, `SECURITY.md`, and `package.json`, with no receipts, temp fixtures, or local paths.
3. **Publish.** `npm publish --access public`.
4. **Verify the install.** `npx -y treeverdict@latest --help`, then `npx -y treeverdict@latest init --yes` in a scratch directory. Confirm both work.
5. **Update the README.** Only now do `npx treeverdict …` instructions become valid. Update the Install section of `README.md` and `README.zh-CN.md` to the `npx treeverdict` form, and keep the tarball line as a fallback for one version. Re-check that no other doc still describes the registry package as unpublished.

## Notes

- Publishing is the maintainer's decision; this file is a checklist, not an instruction to publish.
- After the first publish, consider npm Trusted Publishing (OIDC) for provenance, and keep a normal `v0.1.x` patch flow. Both are optional and out of scope here.
