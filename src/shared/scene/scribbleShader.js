// GPU procedural scribble via WebGL2 vertex-shader stroke tracing.
// Traces tapered ribbon strokes on the GPU for hand-drawn loop quality.
// No radial clip; centralized; low density; scales up with openness.
export function initScribbleShader({ container, strokeCount = 150, canvasClass = 'scribbleLayer' }) {
  const contentWrapper = container.querySelector('#contentWrapper');
  if (!contentWrapper) {
    return {};
  }

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;';
  canvas.classList.add(canvasClass);
  contentWrapper.insertBefore(canvas, contentWrapper.firstChild);

  const glOpts = { alpha: true, antialias: true, premultipliedAlpha: false };
  const gl = canvas.getContext('webgl2', glOpts) || canvas.getContext('webgl', glOpts);
  if (!gl) {
    console.error('scribbleShader: WebGL unavailable');
    return { setOpenness() {} };
  }

  const VS = "#version 300 es\nprecision highp float;\n\nuniform vec2  u_resolution;\nuniform float u_seed;\nuniform float u_stroke;\nuniform float u_strokeCount;\nuniform float u_thicknessScale;\nuniform float u_open;\n\nconst float PI = 3.141592653589793;\nconst int POINTS = 112;\n\nfloat hash11(float p){\n  p = fract(p * 0.1031);\n  p *= p + 33.33;\n  p *= p + p;\n  return fract(p);\n}\n\nvec2 rot(vec2 p, float a){\n  float c = cos(a), s = sin(a);\n  return mat2(c,-s,s,c) * p;\n}\n\nfloat envWidth(float t){\n  float q = abs(t * 2.0 - 1.0);\n  return 0.22 + 0.56 * (1.0 - pow(q, 1.55));\n}\n\nvec2 interiorCurve(float t, float s){\n  float r0 = hash11(s + 0.1);\n  float r1 = hash11(s + 1.7);\n  float r2 = hash11(s + 2.9);\n  float r3 = hash11(s + 4.1);\n  float r4 = hash11(s + 5.6);\n  float r5 = hash11(s + 7.3);\n  float r6 = hash11(s + 9.1);\n  float r7 = hash11(s + 11.6);\n  float r8 = hash11(s + 14.2);\n  float r9 = hash11(s + 17.8);\n  float rA = hash11(s + 21.1);\n  float rB = hash11(s + 25.3);\n\n  float yTop = 0.78 + (r0 - 0.5) * 0.10;\n  float yBot = -0.62 + (r1 - 0.5) * 0.16;\n  float y = mix(yTop, yBot, t);\n\n  float w = envWidth(t) * (0.86 + 0.22 * r2);\n  float centerX = (r3 - 0.5) * 0.10;\n\n  float a = 2.0 * PI * t;\n  float x = 0.0;\n  x += 0.90 * sin(a * mix(1.1, 2.0, r4) + 2.0 * PI * r5);\n  x += 0.45 * sin(a * mix(2.2, 5.0, r6) + 2.0 * PI * r7);\n  x += 0.18 * cos(a * mix(6.0, 11.0, r8) + 2.0 * PI * r9);\n\n  float loopAmp = mix(0.03, 0.11, rA);\n  vec2 loop = vec2(\n    sin(a * mix(8.0, 16.0, rB) + 2.0 * PI * r0),\n    cos(a * mix(7.0, 14.0, r9) + 2.0 * PI * r2)\n  ) * loopAmp * smoothstep(0.03, 0.18, t) * smoothstep(0.03, 0.20, 1.0 - t);\n\n  vec2 p = vec2(centerX + x * w, y);\n  p += loop;\n  p.x += (t - 0.5) * (r1 - 0.5) * 0.12;\n  p.y += 0.05 * sin(a * mix(1.2, 2.7, r3) + 2.0 * PI * r6);\n  return p;\n}\n\nvec2 sideCurve(float t, float s){\n  float r0 = hash11(s + 0.2);\n  float r1 = hash11(s + 1.4);\n  float r2 = hash11(s + 2.8);\n  float r3 = hash11(s + 7.4);\n  float r4 = hash11(s + 5.1);\n  float r5 = hash11(s + 6.6);\n  float r6 = hash11(s + 8.2);\n  float r7 = hash11(s + 10.4);\n  float side = r0 < 0.5 ? -1.0 : 1.0;\n\n  float yTop = 0.86 + (r1 - 0.5) * 0.08;\n  float yBot = -0.52 + (r2 - 0.5) * 0.18;\n  float y = mix(yTop, yBot, t);\n\n  float a = 2.0 * PI * t;\n  float anchor = side * mix(0.56, 0.79, r3);\n  float swing = mix(0.12, 0.26, r4);\n  float innerPull = mix(0.16, 0.30, r5);\n\n  vec2 p;\n  p.x = anchor + swing * sin(a * mix(1.2, 2.8, r6) + 2.0 * PI * r7)\n               - side * innerPull * smoothstep(0.10, 0.55, t) * smoothstep(0.08, 0.38, 1.0 - t);\n  p.y = y + 0.08 * cos(a * mix(1.3, 2.3, r4) + 2.0 * PI * r5);\n\n  vec2 loop = vec2(\n    side * cos(a * mix(5.0, 9.0, r1) + 2.0 * PI * r2),\n    sin(a * mix(5.5, 10.5, r6) + 2.0 * PI * r3)\n  ) * mix(0.02, 0.08, r7);\n  p += loop;\n  return p;\n}\n\nvec2 bottomCurve(float t, float s){\n  float r0 = hash11(s + 0.1);\n  float r1 = hash11(s + 1.6);\n  float r2 = hash11(s + 3.5);\n  float r3 = hash11(s + 5.4);\n  float r4 = hash11(s + 8.7);\n  float r5 = hash11(s + 11.8);\n  float a = 2.0 * PI * t;\n\n  vec2 center = vec2((r0 - 0.5) * 0.12, -0.33 + (r1 - 0.5) * 0.18);\n  vec2 scale = vec2(0.23 + 0.16 * r2, 0.22 + 0.12 * r3);\n\n  vec2 p = vec2(\n    sin(a * mix(0.9, 2.0, r4) + 2.0 * PI * r5) + 0.35 * sin(a * mix(4.5, 8.0, r0) + 2.0 * PI * r2),\n    0.74 * cos(a * mix(0.8, 1.7, r1) + 2.0 * PI * r3) + 0.22 * sin(a * mix(5.0, 9.5, r4) + 2.0 * PI * r5)\n  );\n  p *= scale;\n  p = rot(p, (r2 - 0.5) * 0.6);\n  return center + p;\n}\n\nvec2 curve(float t, float id){\n  float s = id * 19.371 + u_seed * 63.17;\n  float mode = hash11(s + 31.2);\n  float coreEdge = clamp(0.45, 0.05, 0.95);\n  float sideEdge = clamp(0.45 + 0.20, 0.46, 0.99);\n\n  vec2 p;\n  if(mode < coreEdge){\n    p = interiorCurve(t, s);\n  }else if(mode < sideEdge){\n    p = sideCurve(t, s);\n  }else{\n    p = bottomCurve(t, s);\n  }\n\n  float localW = 0.17 + 0.68 * (1.0 - pow(abs((p.y + 0.08) / 0.86), 1.6));\n  float squeeze = 0.18 * smoothstep(localW, localW + 0.16, abs(p.x));\n  p.x = mix(p.x, sign(p.x) * localW, squeeze);\n\n  // Centralize toward the frame center\n  p.x *= 0.87;\n  p.y = (p.y - 0.10) * 1.12;\n\n  return p;\n}\n\nvoid main(){\n  int pointIndex = gl_VertexID / 2;\n  int side = gl_VertexID - pointIndex * 2;\n  float t = float(pointIndex) / float(POINTS - 1);\n  float eps = 1.0 / float(POINTS - 1);\n  float id = u_stroke;\n\n  vec2 p  = curve(t, id);\n  vec2 pa = curve(max(0.0, t - eps), id);\n  vec2 pb = curve(min(1.0, t + eps), id);\n  vec2 tangent = normalize(pb - pa + vec2(1e-6, 0.0));\n  vec2 normal  = vec2(-tangent.y, tangent.x);\n\n  float thickPx = mix(1.5, 4.2, hash11(id * 7.91 + u_seed * 1.7)) * u_thicknessScale;\n  if(hash11(id * 13.1 + 9.0) > 0.90) thickPx *= 0.75;\n\n  float strokeRadius = min(u_open, (id + 1.0) / max(1.0, u_strokeCount));\n  p *= strokeRadius;\n\n  vec2 pxToClip = vec2(2.0 / u_resolution.x, 2.0 / u_resolution.y);\n  vec2 offset = normal * thickPx * (side == 0 ? -0.5 : 0.5) * pxToClip;\n  gl_Position = vec4(p + offset, 0.0, 1.0);\n}\n";
  const FS = "#version 300 es\nprecision highp float;\nout vec4 outColor;\nvoid main(){ outColor = vec4(0.0, 0.0, 0.0, 1.0); }\n";

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(s) || 'shader compile failed');
    }
    return s;
  }

  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('scribbleShader link failed:', gl.getProgramInfoLog(prog));
    return { setOpenness() {} };
  }

  const loc = (n) => gl.getUniformLocation(prog, n);
  const uRes = loc('u_resolution');
  const uSeed = loc('u_seed');
  const uStroke = loc('u_stroke');
  const uStrokeCount = loc('u_strokeCount');
  const uThicknessScale = loc('u_thicknessScale');
  const uOpen = loc('u_open');

  let seed = Math.random() * 100;
  let openness = 0;
  let lastOpenness = 0;
  let pixelRatio = 1;

  // Bind an empty VAO; gl_VertexID drives the geometry.
  const vao = gl.createVertexArray();
  gl.bindVertexArray(vao);

  function resize() {
    const containerRect = container.getBoundingClientRect();
    const wrapperRect = contentWrapper.getBoundingClientRect();
    pixelRatio = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.round(containerRect.width * pixelRatio));
    const h = Math.max(1, Math.round(containerRect.height * pixelRatio));
    canvas.style.left = containerRect.left - wrapperRect.left + 'px';
    canvas.style.top = containerRect.top - wrapperRect.top + 'px';
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
      canvas.style.width = containerRect.width + 'px';
      canvas.style.height = containerRect.height + 'px';
    }
  }

  function draw() {
    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.bindVertexArray(vao);
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uSeed, seed);
    gl.uniform1f(uStrokeCount, strokeCount);
    gl.uniform1f(uThicknessScale, 0.7 * pixelRatio);
    gl.uniform1f(uOpen, openness);
    const count = Math.max(0, Math.round(strokeCount * Math.max(0, Math.min(1, openness))));
    for (let i = 0; i < count; i++) {
      gl.uniform1f(uStroke, i);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 112 * 2);
    }
  }

  function setOpenness(v) {
    const o = Math.max(0, Math.min(1, v));
    if (o > 0.01 && lastOpenness <= 0.01) {
      seed = Math.random() * 100;
    }
    lastOpenness = o;
    openness = o;
    draw();
  }

  window.addEventListener('resize', draw);
  draw();

  return { setOpenness, canvas };
}
