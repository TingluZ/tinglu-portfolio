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
	/** Delaunay triangles outside the airfoil */
	triangles: Uint32Array;
	/** surface point indices on the upper and lower surface, each sorted by x */
	upper: Uint32Array;
	lower: Uint32Array;
	/** airfoil outline as a triangle strip (x, y pairs), drawn over the field as a mask */
	outline: Float32Array;
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
	const { upper, lower } = splitSurface(pos, meta.n_surface);
	const ns = meta.n_surface;
	// Near the wall the export keeps points in layers above every 4th surface
	// point (a station). Surface points between stations would connect to the
	// thin layers through long slivers, so the mesh uses only the stations;
	// the outline mask still follows every surface point.
	const mesh = [...stations(pos, ns), ...Array.from({ length: pos.length / 2 - ns }, (_, i) => ns + i)];
	const tri = new Delaunay(Float64Array.from(mesh.flatMap((i) => [pos[2 * i], pos[2 * i + 1]]))).triangles;

	// Delaunay also fills the airfoil and bridges across it near the thin
	// trailing edge; those triangles would smear upper-surface values onto the
	// lower side. Drop triangles inside the airfoil (all corners on the wall,
	// centroid inside) and triangles with corners on both sides of it that
	// cross it. Others may dip slightly into the airfoil where the wall
	// curves; the outline mask hides that, and dropping them would leave notches.
	const xmin = Math.min(pos[2 * upper[0]], pos[2 * lower[0]]);
	const xmax = Math.max(pos[2 * upper[upper.length - 1]], pos[2 * lower[lower.length - 1]]);
	const inside = (x: number, y: number) =>
		x > xmin && x < xmax && y < surfaceY(pos, upper, x) && y > surfaceY(pos, lower, x);
	// +1 above the camber line, -1 below, 0 ahead of or behind the airfoil
	const side = (i: number) => {
		const x = pos[2 * i], y = pos[2 * i + 1];
		if (x <= xmin || x >= xmax) return 0;
		return y > (surfaceY(pos, upper, x) + surfaceY(pos, lower, x)) / 2 ? 1 : -1;
	};
	const keep: number[] = [];
	for (let t = 0; t < tri.length; t += 3) {
		const a = mesh[tri[t]], b = mesh[tri[t + 1]], c = mesh[tri[t + 2]];
		const ax = pos[2 * a], ay = pos[2 * a + 1], bx = pos[2 * b], by = pos[2 * b + 1], cx = pos[2 * c], cy = pos[2 * c + 1];
		const sa = side(a), sb = side(b), sc = side(c);
		const bridging = Math.min(sa, sb, sc) < 0 && Math.max(sa, sb, sc) > 0;
		if (a < ns && b < ns && c < ns && inside((ax + bx + cx) / 3, (ay + by + cy) / 3)) continue;
		if (
			bridging &&
			(inside((ax + bx + cx) / 3, (ay + by + cy) / 3) ||
				inside((ax + bx) / 2, (ay + by) / 2) ||
				inside((bx + cx) / 2, (by + cy) / 2) ||
				inside((ax + cx) / 2, (ay + cy) / 2))
		) continue;
		keep.push(a, b, c);
	}
	return { meta, pos, values, triangles: Uint32Array.from(keep), upper, lower, outline: outlineStrip(pos, upper, lower) };
}

/**
 * Surface points with an off-wall point almost straight above them: the feet
 * of the export's wall layers, whose first layer sits 2e-4 to 3.4e-4 chords
 * off the wall. Falls back to every surface point for data without layers.
 */
function stations(pos: Float32Array, ns: number) {
	const r2 = 6e-4 ** 2;
	const out: number[] = [];
	for (let i = 0; i < ns; i++) {
		const x = pos[2 * i], y = pos[2 * i + 1];
		for (let j = ns; j < pos.length / 2; j++) {
			if ((pos[2 * j] - x) ** 2 + (pos[2 * j + 1] - y) ** 2 < r2) { out.push(i); break; }
		}
	}
	return out.length > ns / 8 ? out : Array.from({ length: ns }, (_, i) => i);
}

/**
 * Split surface points into upper and lower surface, each sorted by x.
 * AirfRANS airfoils sit at zero incidence with the chord on x in [0, 1]
 * (angle of attack is in the inflow), so a coarse camber line, the midpoint
 * of the lowest and highest surface point in cosine-spaced x bins, separates them.
 */
function splitSurface(pos: Float32Array, nSurface: number) {
	let xmin = Infinity, xmax = -Infinity;
	for (let i = 0; i < nSurface; i++) { xmin = Math.min(xmin, pos[2 * i]); xmax = Math.max(xmax, pos[2 * i]); }
	const NB = 40;
	const bin = (x: number) => {
		const t = Math.min(Math.max((x - xmin) / (xmax - xmin), 0), 1);
		return Math.min(NB - 1, Math.floor((Math.acos(1 - 2 * t) / Math.PI) * NB));
	};
	const bmin = new Array(NB).fill(Infinity), bmax = new Array(NB).fill(-Infinity);
	for (let i = 0; i < nSurface; i++) {
		const b = bin(pos[2 * i]);
		bmin[b] = Math.min(bmin[b], pos[2 * i + 1]);
		bmax[b] = Math.max(bmax[b], pos[2 * i + 1]);
	}
	const mid = bmin.map((v, b) => (Number.isFinite(v) ? (v + bmax[b]) / 2 : NaN));
	for (let b = 1; b < NB; b++) if (Number.isNaN(mid[b])) mid[b] = mid[b - 1];
	for (let b = NB - 2; b >= 0; b--) if (Number.isNaN(mid[b])) mid[b] = mid[b + 1];

	const up: number[] = [], lo: number[] = [];
	for (let i = 0; i < nSurface; i++) (pos[2 * i + 1] >= mid[bin(pos[2 * i])] ? up : lo).push(i);
	const byX = (a: number, b: number) => pos[2 * a] - pos[2 * b];
	return { upper: Uint32Array.from(up.sort(byX)), lower: Uint32Array.from(lo.sort(byX)) };
}

/** Linear interpolation of y along one surface (indices sorted by x). */
function surfaceY(pos: Float32Array, idx: Uint32Array, x: number) {
	let l = 0, r = idx.length - 1;
	if (x <= pos[2 * idx[0]]) return pos[2 * idx[0] + 1];
	if (x >= pos[2 * idx[r]]) return pos[2 * idx[r] + 1];
	while (r - l > 1) { const m = (l + r) >> 1; if (pos[2 * idx[m]] <= x) l = m; else r = m; }
	const x0 = pos[2 * idx[l]], x1 = pos[2 * idx[r]];
	const y0 = pos[2 * idx[l] + 1], y1 = pos[2 * idx[r] + 1];
	return x1 > x0 ? y0 + ((y1 - y0) * (x - x0)) / (x1 - x0) : y0;
}

/**
 * The airfoil as a triangle strip between its lower and upper surface on a
 * cosine-spaced x grid (dense at both edges), so the outline is smooth even
 * where the downsampled field triangles are coarse.
 */
function outlineStrip(pos: Float32Array, upper: Uint32Array, lower: Uint32Array) {
	if (!upper.length || !lower.length) return new Float32Array();
	const x0 = Math.min(pos[2 * upper[0]], pos[2 * lower[0]]);
	const x1 = Math.max(pos[2 * upper[upper.length - 1]], pos[2 * lower[lower.length - 1]]);
	const N = 400;
	const strip = new Float32Array(N * 4);
	for (let i = 0; i < N; i++) {
		const x = x0 + ((1 - Math.cos((Math.PI * i) / (N - 1))) / 2) * (x1 - x0);
		strip.set([x, surfaceY(pos, lower, x), x, surfaceY(pos, upper, x)], i * 4);
	}
	return strip;
}

export function percentile(values: ArrayLike<number>, p: number) {
	const a = Float32Array.from(values).sort();
	return a[Math.min(a.length - 1, Math.max(0, Math.round(p * (a.length - 1))))];
}
