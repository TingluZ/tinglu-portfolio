import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const blog = defineCollection({
	loader: glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		description: z.string(),
		date: z.coerce.date(),
		updated: z.coerce.date().optional(),
		tags: z.array(z.string()).default([]),
		draft: z.boolean().default(false),
	}),
});

const projects = defineCollection({
	loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
	schema: z.object({
		title: z.string(),
		summary: z.string(),
		result: z.string(),
		date: z.coerce.date(),
		tags: z.array(z.string()).default([]),
		featured: z.boolean().default(false),
		order: z.number().default(100),
		code: z.url().optional(),
		demo: z.url().optional(),
		post: z.string().optional(),
		draft: z.boolean().default(false),
	}),
});

export const collections = { blog, projects };
