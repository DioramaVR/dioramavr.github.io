# registry/

`registry.json` and `registry.json.sig` live here and are served byte for byte at
`https://dioramavr.app/registry.json` and `/registry.json.sig`. That URL is built
into shipped installers: never move or rename it.

- **Written by the publish workflows** (dvr-actions): `publish-installer` edits
  `app.latest` and `app.releases`; `publish-mod` edits only its own `games[]` entry.
  Each writes the matching `.sig` in the same commit.
- **Hand edits** (announcements, waves, closedBeta, movedTo) go on a branch, never
  straight to main. The `sign-registry` workflow in dvr-installer reads the branch,
  writes canonical JSON (`JSON.stringify(doc, null, 2) + "\n"`, LF), signs it, and
  commits both files to main in one commit.
- The site build checks the signature against `site-config/trusted-keys.json` and
  stops on any mismatch, so the last good version stays live.

Format: dvr-package's `docs/SPEC.md` (registry) and installer `docs/MOD-DOWNLOADS.md`.
