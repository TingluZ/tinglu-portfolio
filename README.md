# tinglu-portfolio

Personal site: projects, blog and about page. Built with [Astro](https://astro.build), deployed to GitHub Pages on every push to `main`.

## Run locally

```sh
npm install
npm run dev        # http://localhost:4321/tinglu-portfolio/
```

## Common edits

| To change | Edit |
|---|---|
| Name, intro line, contact links | `src/site.ts` |
| Add a blog post | new `src/content/blog/<slug>.mdx` (set `draft: false` to publish) |
| Add a project | new `src/content/projects/<slug>.mdx` |
| About page | `src/pages/about.astro` |
| Colours and fonts | `src/styles/global.css` |

Drafts (`draft: true`) show in `npm run dev` but are left out of the published site.

## Deploying

1. In the repo on GitHub: Settings → Pages → Source: **GitHub Actions**.
2. Push to `main`. The site appears at `https://tingluz.github.io/tinglu-portfolio/`.

To serve it at `https://tingluz.github.io/` instead, rename the repo to `TingluZ.github.io` and set `BASE_PATH` to `/` in `astro.config.mjs`. For a custom domain later, set `SITE_URL` to it and `BASE_PATH` to `/`.
