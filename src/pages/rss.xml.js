import rss from '@astrojs/rss';
import { SITE } from '../site';
import { getPosts } from '../lib';

export async function GET(context) {
	const posts = await getPosts();
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	return rss({
		title: SITE.name,
		description: SITE.description,
		site: context.site + base.replace(/^\//, ''),
		items: posts.map((post) => ({
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.date,
			link: `${base}/blog/${post.id}/`,
		})),
	});
}
