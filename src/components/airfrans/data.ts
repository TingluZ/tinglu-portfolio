// Loader for the static AirfRANS export written by airfrans-fno-gnn/scripts/export_web.py

export const CHANNELS = ['vx', 'vy', 'pressure', 'nu_t'] as const;
export type Channel = (typeof CHANNELS)[number];
export const MODELS = ['fno', 'gnn'] as const;
export type Model = (typeof MODELS)[number];
export type Source = 'truth' | Model;

export interface CaseMeta {
	id: number;
	name: string;
	aoa_deg: number;
	u_inf: number;
	n_points: number;
	n_surface: number;
	error: Record<Model, { all: number[]; surface: number[] }>;
}

export interface Index {
	box: [number, number, number, number];
	channels: Channel[];
	units: Record<Channel, string>;
	scale: number[];
	sources: Source[];
	cases: CaseMeta[];
}

export interface CaseData {
	meta: CaseMeta;
	/** x, y interleaved, in chord lengths */
	pos: Float32Array;
	/** values[source][channel] -> Float32Array(n) in physical units */
	values: Record<Source, Float32Array[]>;
	/** triangle vertex indices, airfoil interior removed */
	triangles: Uint32Array;
}

// float16 -> float32 lookup, built once (Float16Array isn't available everywhere yet)
let F16: Float32Array | undefined;
function f16Table() {
	if (F16) return F16;
	F16 = new Float32Array(65536);
	for (let h = 0; h < 65536; h++) {
		const s = h & 0x8000 ? -1 : 1;
		const e = (h >> 10) & 0x1f;
		const m = h & 0x3ff;
		F16[h] =
			e === 0 ? s * 2 ** -14 * (m / 1024) : e === 31 ? (m ? NaN : s * Infinity) : s * 2 ** (e - 15) * (1 + m / 1024);
	}
	return F16;
}

export async function loadIndex(base: string): Promise<Index> {
	const res = await fetch(`${base}index.json`);
	if (!res.ok) throw new Error(`index.json: ${res.status}`);
	return res.json();
}

const cache = new Map<number, Promise<CaseData>>();

export function loadCase(base: string, index: Index, meta: CaseMeta): Promise<CaseData> {
	let p = cache.get(meta.id);
	if (!p) {
		p = fetchCase(base, index, meta);
		cache.set(meta.id, p);
		p.catch(() => cache.delete(meta.id));
	}
	return p;
}

async function fetchCase(base: string, index: Index, meta: CaseMeta): Promise<CaseData> {
	const res = await fetch(`${base}cases/${meta.id}.bin`);
	if (!res.ok) throw new Error(`case ${meta.id}: ${res.status}`);
	const buf = await res.arrayBuffer();
	const n = meta.n_points;
	const [x0, x1, y0, y1] = index.box;

	const q = new Uint16Array(buf, 0, 2 * n);
	const pos = new Float32Array(2 * n);
	for (let i = 0; i < n; i++) {
		pos[2 * i] = x0 + (q[2 * i] / 65535) * (x1 - x0);
		pos[2 * i + 1] = y0 + (q[2 * i + 1] / 65535) * (y1 - y0);
	}

	const raw = new Uint16Array(buf, 4 * n);
	const table = f16Table();
	const nc = index.channels.length;
	const values = {} as Record<Source, Float32Array[]>;
	index.sources.forEach((src, s) => {
		values[src] = index.channels.map((_, c) => {
			const out = new Float32Array(n);
			const off = (s * nc + c) * n;
			const k = index.scale[c];
			for (let i = 0; i < n; i++) out[i] = table[raw[off + i]] * k;
			return out;
		});
	});

	const { Delaunay } = await import('d3-delaunay');
	const tri = new Delaunay(pos).triangles;
	// The airfoil interior holds no mesh points, so any triangle whose three
	// corners are all surface points spans the inside of the airfoil.
	const ns = meta.n_surface;
	const keep: number[] = [];
	for (let t = 0; t < tri.length; t += 3) {
		const a = tri[t], b = tri[t + 1], c = tri[t + 2];
		if (a < ns && b < ns && c < ns) continue;
		keep.push(a, b, c);
	}
	return { meta, pos, values, triangles: Uint32Array.from(keep) };
}

export function percentile(values: ArrayLike<number>, p: number) {
	const a = Float32Array.from(values).sort();
	return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
}
