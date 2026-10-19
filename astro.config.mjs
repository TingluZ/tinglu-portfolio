// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

// GitHub Pages: a repo named <user>.github.io is served at the root;
// any other repo is served under /<repo-name>/. Set BASE_PATH='/' after renaming.
export default defineConfig({
	site: process.env.SITE_URL ?? 'https://tingluz.github.io',
	base: process.env.BASE_PATH ?? '/tinglu-portfolio',
	trailingSlash: 'ignore',
	integrations: [mdx(), sitemap()],
	markdown: {
		shikiConfig: { themes: { light: 'github-light', dark: 'github-dark' } },
	},
});
