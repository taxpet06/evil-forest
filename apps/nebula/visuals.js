import { noteColor, fifths } from './music.js';

// Look-and-feel knobs. Tune on the projector, not the laptop screen.
const CFG = {
  simRes: 160, // velocity grid, short side
  dyeRes: 1024, // colour grid, short side
  maxRenderWidth: 2560, // caps fill cost on 4K projectors
  pressureIters: 25,
  curl: 30, // swirliness; mod wheel adds to it
  velocityDissipation: 0.45,
  dyeDissipation: 1.0, // lower = longer trails
  exposure: 1.7,
  maxSparks: 3000,
};

const VERT = `#version 300 es
in vec2 aPos;
uniform vec2 texel;
out vec2 vUv, vL, vR, vT, vB;
void main() {
  vUv = aPos * .5 + .5;
  vL = vUv - vec2(texel.x, 0.); vR = vUv + vec2(texel.x, 0.);
  vT = vUv + vec2(0., texel.y); vB = vUv - vec2(0., texel.y);
  gl_Position = vec4(aPos, 0., 1.);
}`;

const frag = (body) => `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 vUv, vL, vR, vT, vB;
out vec4 o;
${body}`;

const SHADERS = {
  splat: frag(`
uniform sampler2D uTarget;
uniform float aspect, radius;
uniform vec2 point;
uniform vec3 color;
void main() {
  vec2 p = vUv - point; p.x *= aspect;
  o = vec4(texture(uTarget, vUv).xyz + exp(-dot(p, p) / radius) * color, 1.);
}`),
  advect: frag(`
uniform sampler2D uVelocity, uSource;
uniform vec2 texel;
uniform float dt, dissipation;
void main() {
  vec2 coord = vUv - dt * texture(uVelocity, vUv).xy * texel;
  o = vec4(texture(uSource, coord).rgb / (1. + dissipation * dt), 1.);
}`),
  divergence: frag(`
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).x, R = texture(uVelocity, vR).x;
  float T = texture(uVelocity, vT).y, B = texture(uVelocity, vB).y;
  vec2 C = texture(uVelocity, vUv).xy;
  if (vL.x < 0.) L = -C.x; if (vR.x > 1.) R = -C.x;
  if (vT.y > 1.) T = -C.y; if (vB.y < 0.) B = -C.y;
  o = vec4(.5 * (R - L + T - B), 0., 0., 1.);
}`),
  curl: frag(`
uniform sampler2D uVelocity;
void main() {
  float L = texture(uVelocity, vL).y, R = texture(uVelocity, vR).y;
  float T = texture(uVelocity, vT).x, B = texture(uVelocity, vB).x;
  o = vec4(.5 * (R - L - T + B), 0., 0., 1.);
}`),
  vorticity: frag(`
uniform sampler2D uVelocity, uCurl;
uniform float curl, dt;
void main() {
  float L = texture(uCurl, vL).x, R = texture(uCurl, vR).x;
  float T = texture(uCurl, vT).x, B = texture(uCurl, vB).x;
  float C = texture(uCurl, vUv).x;
  vec2 f = .5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
  f = f / (length(f) + 1e-4) * curl * C;
  f.y *= -1.;
  o = vec4(clamp(texture(uVelocity, vUv).xy + f * dt, -1000., 1000.), 0., 1.);
}`),
  pressure: frag(`
uniform sampler2D uPressure, uDivergence;
void main() {
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4((L + R + B + T - texture(uDivergence, vUv).x) * .25, 0., 0., 1.);
}`),
  gradient: frag(`
uniform sampler2D uPressure, uVelocity;
void main() {
  float L = texture(uPressure, vL).x, R = texture(uPressure, vR).x;
  float T = texture(uPressure, vT).x, B = texture(uPressure, vB).x;
  o = vec4(texture(uVelocity, vUv).xy - vec2(R - L, T - B), 0., 1.);
}`),
  scale: frag(`
uniform sampler2D uSource;
uniform float value;
void main() { o = value * texture(uSource, vUv); }`),
  down: frag(`
uniform sampler2D uSource;
uniform vec2 srcTexel;
void main() {
  vec2 d = srcTexel * 2.;
  vec3 c = texture(uSource, vUv).rgb
    + texture(uSource, vUv + vec2(-d.x, -d.y)).rgb + texture(uSource, vUv + vec2(d.x, -d.y)).rgb
    + texture(uSource, vUv + vec2(-d.x, d.y)).rgb + texture(uSource, vUv + vec2(d.x, d.y)).rgb;
  o = vec4(c * .2, 1.);
}`),
  display: frag(`
uniform sampler2D uDye, uGlowA, uGlowB;
uniform vec2 glowTexel;
uniform float time, aspect, fade, energy, exposure;
uniform vec3 bgA, bgB;

float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0., a = .5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}
vec3 stars(vec2 uv, float density, float size, float seed) {
  vec2 sp = uv * density, cell = floor(sp);
  float h = hash(cell + seed);
  if (h < .97) return vec3(0);
  vec2 c = fract(sp) - .5 - (vec2(hash(cell + 1.7), hash(cell + 3.1)) - .5) * .7;
  float tw = .55 + .45 * sin(time * (.6 + h * 2.5) + h * 60.);
  return mix(vec3(.75, .8, 1.), vec3(1., .85, .9), hash(cell + 9.)) * exp(-dot(c, c) * size) * tw * (h - .97) * 33.;
}
void main() {
  vec2 p = (vUv - .5) * vec2(aspect, 1.);
  float t = time * .012;

  // Gas clouds, domain-warped so they curl rather than blob
  vec2 q = vec2(fbm(p * 1.2 + t), fbm(p * 1.2 - t + 5.2));
  float n = fbm(p * 1.7 + q * 1.8 + vec2(t * .6, -t));
  float n2 = fbm(p * 3.2 - q * 1.3 + 9.1 + t);
  vec3 bg = vec3(.018, .01, .042)
    + bgA * pow(n, 2.6) * (.5 + .3 * energy)
    + bgB * pow(n2, 4.) * (.3 + .2 * energy);
  bg += stars(p, 160., 140., 0.) + stars(p, 55., 60., 4.) * 1.4;

  vec3 dye = texture(uDye, vUv).rgb;
  vec3 g = texture(uGlowA, vUv).rgb * .55;
  vec2 d = glowTexel * .6;
  g += (texture(uGlowB, vUv + vec2(-d.x, -d.y)).rgb + texture(uGlowB, vUv + vec2(d.x, -d.y)).rgb
      + texture(uGlowB, vUv + vec2(-d.x, d.y)).rgb + texture(uGlowB, vUv + vec2(d.x, d.y)).rgb) * .25;

  vec3 light = dye + g * 1.5;
  light = max(mix(vec3(dot(light, vec3(.3, .5, .2))), light, 1.6), 0.);
  vec3 c = bg + light;
  c = 1. - exp(-c * exposure);
  float vig = smoothstep(1.3, .2, length(p * vec2(.75, 1.)));
  c *= mix(.45, 1., vig);
  c += (hash(vUv * 977. + fract(time * 7.)) - .5) * .02;
  o = vec4(c * fade, 1.);
}`),
};

const SPARK_VERT = `#version 300 es
in vec2 aPos;
in vec4 aCol;
in float aSize;
out vec4 vCol;
void main() { gl_Position = vec4(aPos * 2. - 1., 0., 1.); gl_PointSize = aSize; vCol = aCol; }`;
const SPARK_FRAG = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 o;
void main() {
  vec2 p = gl_PointCoord * 2. - 1.;
  float core = exp(-dot(p, p) * 14.);
  float flare = exp(-abs(p.x) * 30.) * exp(-p.y * p.y * 2.5) + exp(-abs(p.y) * 30.) * exp(-p.x * p.x * 2.5);
  o = vec4(vCol.rgb * (core + flare * .45) * vCol.a, 1.);
}`;

export function createVisuals(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' });
  if (!gl || !gl.getExtension('EXT_color_buffer_float')) throw new Error('This graphics card does not support WebGL2 float rendering.');

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  function program(vs, fs) {
    const p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {};
    for (let i = 0; i < gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i++) {
      const name = gl.getActiveUniform(p, i).name;
      u[name] = gl.getUniformLocation(p, name);
    }
    return { p, u };
  }
  const prog = Object.fromEntries(Object.entries(SHADERS).map(([k, fs]) => [k, program(VERT, fs)]));

  const quad = gl.createVertexArray();
  gl.bindVertexArray(quad);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  function target(w, h) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null);
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    return { tex, fb, w, h, texel: [1 / w, 1 / h] };
  }
  const pingpong = (w, h) => ({
    read: target(w, h), write: target(w, h),
    swap() { [this.read, this.write] = [this.write, this.read]; },
  });

  function run(p, uniforms, out) {
    gl.useProgram(p.p);
    let unit = 0;
    for (const [k, v] of Object.entries(uniforms)) {
      const loc = p.u[k];
      if (loc == null) continue;
      if (v instanceof WebGLTexture) {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, v);
        gl.uniform1i(loc, unit++);
      } else if (typeof v === 'number') gl.uniform1f(loc, v);
      else gl[`uniform${v.length}fv`](loc, v);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, out ? out.fb : null);
    gl.viewport(0, 0, out ? out.w : canvas.width, out ? out.h : canvas.height);
    gl.bindVertexArray(quad);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  // Grids, rebuilt on resize (clears the picture, which only happens when the window changes)
  let vel, dye, pressure, divergence, curlT, glowA, glowB, aspect = 1;
  function resize() {
    const scale = Math.min(devicePixelRatio, CFG.maxRenderWidth / innerWidth);
    canvas.width = Math.round(innerWidth * scale);
    canvas.height = Math.round(innerHeight * scale);
    aspect = canvas.width / canvas.height;
    const size = (base) => (aspect > 1 ? [Math.round(base * aspect), base] : [base, Math.round(base / aspect)]);
    for (const t of [vel?.read, vel?.write, dye?.read, dye?.write, pressure?.read, pressure?.write, divergence, curlT, glowA, glowB]) {
      if (t) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fb); }
    }
    const [sw, sh] = size(CFG.simRes), [dw, dh] = size(CFG.dyeRes);
    vel = pingpong(sw, sh);
    pressure = pingpong(sw, sh);
    divergence = target(sw, sh);
    curlT = target(sw, sh);
    dye = pingpong(dw, dh);
    glowA = target(Math.ceil(dw / 4), Math.ceil(dh / 4));
    glowB = target(Math.ceil(dw / 16), Math.ceil(dh / 16));
  }
  resize();
  addEventListener('resize', resize);

  function splat(field, x, y, color, radius) {
    run(prog.splat, { texel: field.read.texel, uTarget: field.read.tex, aspect, point: [x, y], color, radius }, field.write);
    field.swap();
  }
  const push = (x, y, fx, fy, r) => splat(vel, x, y, [fx, fy, 0], r);
  const paint = (x, y, rgb, k, r) => splat(dye, x, y, rgb.map((c) => c * k), r);

  function step(dt) {
    const t = vel.read.texel;
    run(prog.curl, { texel: t, uVelocity: vel.read.tex }, curlT);
    run(prog.vorticity, { texel: t, uVelocity: vel.read.tex, uCurl: curlT.tex, curl: CFG.curl + mod * 45, dt }, vel.write);
    vel.swap();
    run(prog.divergence, { texel: t, uVelocity: vel.read.tex }, divergence);
    run(prog.scale, { texel: t, uSource: pressure.read.tex, value: 0.8 }, pressure.write);
    pressure.swap();
    for (let i = 0; i < CFG.pressureIters; i++) {
      run(prog.pressure, { texel: t, uPressure: pressure.read.tex, uDivergence: divergence.tex }, pressure.write);
      pressure.swap();
    }
    run(prog.gradient, { texel: t, uPressure: pressure.read.tex, uVelocity: vel.read.tex }, vel.write);
    vel.swap();
    run(prog.advect, { texel: t, uVelocity: vel.read.tex, uSource: vel.read.tex, dt, dissipation: CFG.velocityDissipation }, vel.write);
    vel.swap();
    run(prog.advect, { texel: t, uVelocity: vel.read.tex, uSource: dye.read.tex, dt, dissipation: CFG.dyeDissipation }, dye.write);
    dye.swap();
  }

  // Sparks: CPU particles, drawn as additive star sprites
  const sparkProg = program(SPARK_VERT, SPARK_FRAG);
  const sparkVao = gl.createVertexArray();
  const sparkBuf = gl.createBuffer();
  const sparkData = new Float32Array(CFG.maxSparks * 7);
  gl.bindVertexArray(sparkVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
  gl.bufferData(gl.ARRAY_BUFFER, sparkData.byteLength, gl.DYNAMIC_DRAW);
  [['aPos', 2, 0], ['aCol', 4, 8], ['aSize', 1, 24]].forEach(([name, n, off]) => {
    const loc = gl.getAttribLocation(sparkProg.p, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 28, off);
  });
  const sparks = [];
  function spawn(x, y, rgb, count, speed) {
    for (let i = 0; i < count && sparks.length < CFG.maxSparks; i++) {
      const a = Math.random() * Math.PI * 2, s = speed * (0.15 + Math.random());
      const w = 0.25 + Math.random() * 0.5; // whiten toward starlight
      const life = 1.2 + Math.random() * 2.4;
      sparks.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life,
        size: 5 + Math.random() ** 3 * 30, tw: 6 + Math.random() * 14, seed: Math.random() * 6.3,
        rgb: rgb.map((c) => c * (1 - w) + w),
      });
    }
  }
  function drawSparks(dt, time) {
    const px = canvas.height / 1080;
    let n = 0;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.life -= dt;
      if (p.life <= 0) { sparks[i] = sparks[sparks.length - 1]; sparks.pop(); continue; }
      const dx = (p.x - 0.5) * aspect, dy = p.y - 0.5;
      p.vx += -dy * 0.12 * dt; // slow galactic rotation
      p.vy += dx * 0.12 * dt;
      const drag = Math.exp(-1.7 * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.x += (p.vx * dt) / aspect;
      p.y += p.vy * dt;
      const a = (p.life / p.max) ** 1.5 * (0.55 + 0.45 * Math.sin(time * p.tw + p.seed));
      sparkData.set([p.x, p.y, ...p.rgb, a, p.size * px], n++ * 7);
    }
    if (!n) return;
    gl.useProgram(sparkProg.p);
    gl.bindVertexArray(sparkVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, sparkBuf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, sparkData, 0, n * 7);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArrays(gl.POINTS, 0, n);
    gl.disable(gl.BLEND);
  }

  // Musical state
  const emitters = []; // one per sounding note: a point orbiting the centre, trailing dye
  const onsets = [];
  let time = 0, mod = 0, bend = 0, energy = 0, sustain = false, lastBloom = 0, nextGust = 2;
  let bgA = [0.4, 0.2, 0.9], bgB = [0.1, 0.5, 0.9], bgTargetA = bgA, bgTargetB = bgB;

  // Pitch class picks the angle (circle of fifths, matching the colour wheel), octave picks the radius.
  const place = (note) => ({
    angle: (fifths(note) / 12) * Math.PI * 2 + time * 0.03,
    r: 0.1 + 0.32 * Math.min(1, Math.max(0, (note - 36) / 60)),
  });
  const pos = (e) => [0.5 + (Math.cos(e.angle) * e.r) / aspect, 0.5 + Math.sin(e.angle) * e.r];

  function noteOn(note, vel127) {
    const v = vel127 / 127, color = noteColor(note);
    const e = { note, v, color, born: time, held: true, releasedAt: Infinity, ...place(note) };
    emitters.push(e);
    const [x, y] = pos(e);
    const tx = -Math.sin(e.angle), ty = Math.cos(e.angle); // tangent: counter-clockwise
    const ox = Math.cos(e.angle), oy = Math.sin(e.angle);
    const force = 110 + 240 * v;
    push(x, y, (tx * 0.8 + ox * 0.3) * force, (ty * 0.8 + oy * 0.3) * force, 0.0012 + 0.0016 * v);
    // A few offset splats along the orbit, so a strike starts ragged instead of as a ball
    for (let i = -1; i <= 1; i++) {
      const j = i * (0.012 + 0.02 * v) + (Math.random() - 0.5) * 0.01;
      paint(x + (tx * j) / aspect, y + ty * j, color, (0.45 + 0.9 * v) * (i ? 0.55 : 1), (0.0003 + 0.0008 * v) * (i ? 0.6 : 1));
    }
    spawn(x, y, color, Math.round(18 + 50 * v), 0.06 + 0.2 * v);
    energy = Math.min(1.5, energy + 0.15 + 0.25 * v);

    // Three or more notes struck together bloom outward from the centre
    onsets.push({ t: time, color });
    while (onsets.length && time - onsets[0].t > 0.06) onsets.shift();
    if (onsets.length >= 3 && time - lastBloom > 0.25) {
      lastBloom = time;
      const mix = [0, 1, 2].map((i) => onsets.reduce((s, o) => s + o.color[i], 0) / onsets.length);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + time;
        const bx = 0.5 + (Math.cos(a) * 0.06) / aspect, by = 0.5 + Math.sin(a) * 0.06;
        push(bx, by, Math.cos(a) * 420, Math.sin(a) * 420, 0.0009);
        paint(bx, by, onsets[i % onsets.length].color, 0.45, 0.0005);
        spawn(bx, by, mix, 14, 0.35);
      }
    }
  }
  function noteOff(note) {
    for (const e of emitters) if (e.note === note && e.held) { e.held = false; if (!sustain) e.releasedAt = time; }
  }
  function setSustain(on) {
    sustain = on;
    if (!on) for (const e of emitters) if (!e.held && e.releasedAt === Infinity) e.releasedAt = time;
  }
  function setBend(b) {
    const d = b - bend;
    bend = b;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      push(0.5 + (Math.cos(a) * 0.22) / aspect, 0.5 + Math.sin(a) * 0.22, -Math.sin(a) * d * 1500, Math.cos(a) * d * 1500, 0.01);
    }
  }
  // Dim warm colours read as brown, so the background gas leans toward violet
  const toGas = (c) => c.map((x, i) => x * 0.55 + [0.3, 0.12, 0.85][i] * 0.45);
  function padChord(chord) {
    bgTargetA = toGas(noteColor(chord[0]));
    bgTargetB = toGas(noteColor(chord[2]));
    // Slow, faint wisps of the new harmony drifting in from the edges
    chord.slice(0, 3).forEach((n) => {
      const a = Math.random() * Math.PI * 2;
      const x = 0.5 + (Math.cos(a) * 0.45) / aspect, y = 0.5 + Math.sin(a) * 0.4;
      push(x, y, -Math.cos(a) * 60 - Math.sin(a) * 90, -Math.sin(a) * 60 + Math.cos(a) * 90, 0.02);
      paint(x, y, noteColor(n), 0.06, 0.02);
    });
  }

  const started = performance.now();
  let last = started;
  function frame(now) {
    const dt = Math.min((now - last) / 1000, 1 / 30);
    last = now;
    time += dt;
    energy *= Math.exp(-dt * 0.5);
    const lerp = (a, b) => a.map((x, i) => x + (b[i] - x) * Math.min(1, dt * 0.25));
    bgA = lerp(bgA, bgTargetA);
    bgB = lerp(bgB, bgTargetB);

    // Sounding notes keep trailing colour as they orbit, fading like the celesta does
    for (let i = emitters.length - 1; i >= 0; i--) {
      const e = emitters[i];
      const level = e.v * Math.exp(-(time - e.born) / 2.6) * Math.exp(-Math.max(0, time - e.releasedAt) / 0.35);
      if (level < 0.015) { emitters.splice(i, 1); continue; }
      e.angle += dt * (0.35 + 0.2 * e.v);
      e.r += dt * 0.012;
      const [x, y] = pos(e);
      paint(x, y, e.color, level * dt * 4, 0.00035);
      push(x, y, -Math.sin(e.angle) * 70 * level, Math.cos(e.angle) * 70 * level, 0.0008);
    }

    // Idle breathing so the fluid never freezes
    if ((nextGust -= dt) < 0) {
      nextGust = 1.5 + Math.random() * 2.5;
      const a = Math.random() * Math.PI * 2;
      push(Math.random(), Math.random(), Math.cos(a) * 140, Math.sin(a) * 140, 0.012);
    }

    step(dt);
    run(prog.down, { texel: dye.read.texel, uSource: dye.read.tex, srcTexel: dye.read.texel }, glowA);
    run(prog.down, { texel: glowA.texel, uSource: glowA.tex, srcTexel: glowA.texel }, glowB);
    const t = (now - started) / 1000;
    run(prog.display, {
      texel: [1 / canvas.width, 1 / canvas.height], uDye: dye.read.tex, uGlowA: glowA.tex, uGlowB: glowB.tex,
      glowTexel: glowB.texel, time, aspect, energy: Math.min(energy, 1), exposure: CFG.exposure,
      fade: 1 - (1 - Math.min(t / 4, 1)) ** 3, bgA, bgB,
    }, null);
    drawSparks(dt, time);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { noteOn, noteOff, setSustain, setBend, setMod: (x) => (mod = x), padChord };
}
