# dioramavr.github.io

The DioramaVR website, served at **https://dioramavr.app** by GitHub Pages.

It also publishes the files the DioramaVR installer reads. These URLs are built into
shipped installers and must never move or be renamed:

- `/registry.json`
- `/<game>/index.json` (for example `/tpm-vr/index.json`)

## How it's built

An [Astro](https://astro.build) site, built and deployed by GitHub Actions
(`.github/workflows/deploy.yml`) on every push to `main`, when a game release is
published (`repository_dispatch`), and nightly. Nothing to build by hand.

- `src/data/load.ts` is the only code that reads data. Formats are owned by the
  installer repo (`docs/MOD-DOWNLOADS.md`); the site only reads them.
- In CI, `scripts/fetch-data.mjs` fetches the registry, `credits.json` and each
  game's `data/` folder from the public repos (`site-config/sources.json`) into
  `data/`. Locally the site builds from `sample-data/` (made-up versions and hashes).
- `registry.json` and `<game>/index.json` are copied byte for byte (indexes are signed).
- The look is in one stylesheet, `src/styles/site.css`; the tokens at its top
  are the place to change it. Brand files in `public/` come from `tools/dvr-brand`.

To preview locally (Node 24): `npm install`, then `npm run dev`.
