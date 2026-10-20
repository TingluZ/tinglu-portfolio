// WebGL2 renderer for one scalar field on a triangulated point cloud.
// Values are interpolated across each triangle and coloured through a 1-D colormap texture.

export interface View {
	cx: number; // centre, chord lengths
	cy: number;
	ppu: number; // CSS pixels per chord length
}

// Perceptually ordered colormaps, sampled from matplotlib's viridis and magma
const VIRIDIS = ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'];
const MAGMA = ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'];
export const COLORMAPS = { field: VIRIDIS, error: MAGMA };
export type ColormapName = keyof typeof COLORMAPS;

function hex(c: string) {
	return [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
}

export function colormapCss(name: ColormapName) {
	const stops = COLORMAPS[name];
	return `linear-gradient(to right, ${stops.map((c, i) => `${c} ${(i / (stops.length - 1)) * 100}%`).join(', ')})`;
}

function colormapPixels(name: ColormapName) {
	const stops = COLORMAPS[name].map(hex);
	const px = new Uint8Array(256 * 4);
	for (let i = 0; i < 256; i++) {
		const t = (i / 255) * (stops.length - 1);
		const j = Math.min(Math.floor(t), stops.length - 2);
		const f = t - j;
		for (let k = 0; k < 3; k++) px[i * 4 + k] = Math.round(stops[j][k] * (1 - f) + stops[j + 1][k] * f);
		px[i * 4 + 3] = 255;
	}
	return px;
}

const VERT = `#version 300 es
in vec2 a_pos;
in float a_val;
uniform vec2 u_center;
uniform vec2 u_scale;
out float v_val;
void main() {
	v_val = a_val;
	gl_Position = vec4((a_pos - u_center) * u_scale, 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in float v_val;
uniform sampler2D u_cmap;
uniform vec2 u_range;
uniform vec4 u_solid;
out vec4 color;
void main() {
	if (u_solid.a > 0.0) { color = u_solid; return; }
	float t = clamp((v_val - u_range.x) / (u_range.y - u_range.x), 0.0, 1.0);
	color = texture(u_cmap, vec2(t, 0.5));
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
	const s = gl.createShader(type)!;
	gl.shaderSource(s, src);
	gl.compileShader(s);
	if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
	return s;
}

export class FieldCanvas {
	readonly canvas: HTMLCanvasElement;
	private gl: WebGL2RenderingContext;
	private prog: WebGLProgram;
	private posBuf: WebGLBuffer;
	private valBuf: WebGLBuffer;
	private idxBuf: WebGLBuffer;
	private maskBuf: WebGLBuffer;
	private maskCount = 0;
	private textures: Record<ColormapName, WebGLTexture>;
	private count = 0;
	private cmap: ColormapName = 'field';
	private range: [number, number] = [0, 1];
	private loc: Record<string, WebGLUniformLocation | null>;

	constructor(canvas: HTMLCanvasElement) {
		this.canvas = canvas;
		const gl = canvas.getContext('webgl2', { antialias: true, premultipliedAlpha: false });
		if (!gl) throw new Error('WebGL2 is not available in this browser');
		this.gl = gl;
		const prog = gl.createProgram()!;
		gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
		gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
		gl.linkProgram(prog);
		this.prog = prog;
		this.loc = Object.fromEntries(
			['u_center', 'u_scale', 'u_cmap', 'u_range', 'u_solid'].map((n) => [n, gl.getUniformLocation(prog, n)]),
		);
		this.posBuf = gl.createBuffer()!;
		this.valBuf = gl.createBuffer()!;
		this.idxBuf = gl.createBuffer()!;
		this.maskBuf = gl.createBuffer()!;
		this.textures = { field: this.texture('field'), error: this.texture('error') };
	}

	private texture(name: ColormapName) {
		const gl = this.gl;
		const tex = gl.createTexture()!;
		gl.bindTexture(gl.TEXTURE_2D, tex);
		gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, colormapPixels(name));
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		return tex;
	}

	/** `mask` is a triangle strip (x, y pairs) painted in the background colour over the field. */
	setMesh(pos: Float32Array, triangles: Uint32Array, mask: Float32Array) {
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuf);
		gl.bufferData(gl.ARRAY_BUFFER, mask, gl.STATIC_DRAW);
		this.maskCount = mask.length / 2;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
		gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
		gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, triangles, gl.STATIC_DRAW);
		this.count = triangles.length;
	}

	setValues(values: Float32Array, range: [number, number], cmap: ColormapName) {
		const gl = this.gl;
		gl.bindBuffer(gl.ARRAY_BUFFER, this.valBuf);
		gl.bufferData(gl.ARRAY_BUFFER, values, gl.DYNAMIC_DRAW);
		this.range = range[1] > range[0] ? range : [range[0], range[0] + 1e-9];
		this.cmap = cmap;
	}

	draw(view: View, background: [number, number, number]) {
		const gl = this.gl;
		const dpr = window.devicePixelRatio || 1;
		const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
		if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(h * dpr)) {
			this.canvas.width = Math.round(w * dpr);
			this.canvas.height = Math.round(h * dpr);
		}
		gl.viewport(0, 0, this.canvas.width, this.canvas.height);
		gl.clearColor(background[0] / 255, background[1] / 255, background[2] / 255, 1);
		gl.clear(gl.COLOR_BUFFER_BIT);
		if (!this.count || !w || !h) return;

		gl.useProgram(this.prog);
		const aPos = gl.getAttribLocation(this.prog, 'a_pos');
		gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
		gl.enableVertexAttribArray(aPos);
		gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
		const aVal = gl.getAttribLocation(this.prog, 'a_val');
		gl.bindBuffer(gl.ARRAY_BUFFER, this.valBuf);
		gl.enableVertexAttribArray(aVal);
		gl.vertexAttribPointer(aVal, 1, gl.FLOAT, false, 0, 0);

		gl.uniform2f(this.loc.u_center, view.cx, view.cy);
		gl.uniform2f(this.loc.u_scale, (2 * view.ppu) / w, (2 * view.ppu) / h);
		gl.uniform2f(this.loc.u_range, this.range[0], this.range[1]);
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_2D, this.textures[this.cmap]);
		gl.uniform1i(this.loc.u_cmap, 0);

		gl.uniform4f(this.loc.u_solid, 0, 0, 0, 0);
		gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
		gl.drawElements(gl.TRIANGLES, this.count, gl.UNSIGNED_INT, 0);

		if (this.maskCount) {
			gl.disableVertexAttribArray(aVal);
			gl.vertexAttrib1f(aVal, 0);
			gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuf);
			gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
			gl.uniform4f(this.loc.u_solid, background[0] / 255, background[1] / 255, background[2] / 255, 1);
			gl.drawArrays(gl.TRIANGLE_STRIP, 0, this.maskCount);
		}
	}
}
