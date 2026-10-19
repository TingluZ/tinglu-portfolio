// Edit your name, intro and links here; every page reads from this file.
export const SITE = {
	name: 'Tinglu Zhang',
	title: 'Tinglu Zhang · ML, data science and scientific computing',
	description:
		'Projects and writing on machine learning, data science and physics-aware surrogate models.',
	tagline:
		'I build machine learning systems for the physical world, from CFD surrogate models to production data pipelines.',
	location: 'London, UK',
	links: {
		github: 'https://github.com/TingluZ',
		linkedin: '', // TODO: add your LinkedIn URL
		email: '', // TODO: add the email you want public
	},
};

/** Prefix an internal path with the deploy base (needed on GitHub Pages project sites). */
export function url(path = '/'): string {
	const base = import.meta.env.BASE_URL.replace(/\/$/, '');
	return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}
