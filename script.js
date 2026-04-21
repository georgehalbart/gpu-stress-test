(function () {
    'use strict';

    /* Elements */
    const canvas = document.getElementById('gpu-canvas');
    const graphCv = document.getElementById('gpu-graph');
    const gpuName = document.getElementById('gpu-name');
    const gpuVendor = document.getElementById('gpu-vendor');
    const gpuVer = document.getElementById('gpu-webgl-ver');
    const fpsBadge = document.getElementById('gpu-fps-badge');
    const fpsSub = document.getElementById('gpu-fps-sub');
    const idleMsg = document.getElementById('gpu-idle-msg');
    const avgFpsEl = document.getElementById('gpu-avg-fps');
    const minFpsEl = document.getElementById('gpu-min-fps');
    const maxFpsEl = document.getElementById('gpu-max-fps');
    const trisEl = document.getElementById('gpu-tris');
    const benResEl = document.getElementById('gpu-bench-result');
    const benScore = document.getElementById('gpu-bench-score');
    const benGrade = document.getElementById('gpu-bench-grade');
    const benDesc = document.getElementById('gpu-bench-desc');
    const intSlider = document.getElementById('gpu-intensity');
    const intValEl = document.getElementById('gpu-int-val');
    const startBtn = document.getElementById('gpu-start');
    const stopBtn = document.getElementById('gpu-stop');
    const benchBtn = document.getElementById('gpu-bench');
    const runPanel = document.getElementById('gpu-run-panel');
    const runStatus = document.getElementById('gpu-run-status');
    const runElapsed = document.getElementById('gpu-run-elapsed');
    const runFps = document.getElementById('gpu-run-fps');
    const runFill = document.getElementById('gpu-run-fill');
    const runPct = document.getElementById('gpu-run-pct');
    const progContainer = document.getElementById('gpu-progress-container');
    const benchTimeSel = document.getElementById('gpu-bench-time');

    /* WebGL Configuration */
    let gl = null;
    try {
        gl = canvas.getContext('webgl', { antialias: false, powerPreference: 'high-performance' });
        if (!gl) { gl = canvas.getContext('experimental-webgl'); }
    } catch (e) { }

    if (gl) {
        try {
            const dbg = gl.getExtension('WEBGL_debug_renderer_info');
            if (dbg) {
                const uRen = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
                const uVen = gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL);
                gpuName.textContent = uRen ? uRen : 'Unknown GPU';
                gpuVendor.textContent = uVen ? uVen : '';
            } else {
                const ren = gl.getParameter(gl.RENDERER);
                const ven = gl.getParameter(gl.VENDOR);
                gpuName.textContent = ren ? ren : 'WebGL GPU';
                gpuVendor.textContent = ven ? ven : '';
            }
        } catch (e) { gpuName.textContent = 'WebGL GPU'; }
        
        try {
            const gl2 = canvas.getContext('webgl2');
            gpuVer.textContent = gl2 ? 'WebGL 2.0' : 'WebGL 1.0';
        } catch (e) { gpuVer.textContent = 'WebGL 1.0'; }
    } else {
        gpuName.textContent = 'WebGL not available';
        gpuVendor.textContent = 'Try Chrome, Firefox, or Edge';
        if(startBtn) startBtn.disabled = true;
        if(benchBtn) benchBtn.disabled = true;
    }

    /* Shader compilation helpers */
    function mkShader(type, src) {
        if (!gl) return null;
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error('Shader compilation error string:\n' + src);
            console.error('Shader compiler error log:\n' + gl.getShaderInfoLog(s));
        }
        return s;
    }

    function mkProg(vs, fs) {
        if (!gl) return null;
        const p = gl.createProgram();
        const vShader = mkShader(gl.VERTEX_SHADER, vs);
        const fShader = mkShader(gl.FRAGMENT_SHADER, fs);
        
        if (!vShader || !fShader) return null;
        
        gl.attachShader(p, vShader);
        gl.attachShader(p, fShader);
        gl.linkProgram(p);
        
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error('Program linking error log:\n' + gl.getProgramInfoLog(p));
            return null;
        }
        return p;
    }

    /* GLSL Shaders safely defined */
    const PART_VS = "attribute vec2 a_pos;\nattribute float a_sz;\nattribute vec3 a_col;\nvarying vec3 v_col;\nvoid main() {\n  v_col = a_col;\n  gl_Position = vec4(a_pos, 0.0, 1.0);\n  gl_PointSize = a_sz;\n}";
    
    const PART_FS = "precision mediump float;\nvarying vec3 v_col;\nvoid main() {\n  float d = length(gl_PointCoord - 0.5) * 2.0;\n  if (d > 1.0) discard;\n  gl_FragColor = vec4(v_col, 1.0 - d * 0.5);\n}";

    const TRI_VS = "attribute vec2 a_pos;\nuniform float u_t;\nvoid main() {\n  float a = u_t * 0.6;\n  mat2 r = mat2(cos(a), -sin(a), sin(a), cos(a));\n  gl_Position = vec4(r * a_pos, 0.0, 1.0);\n}";
    
    const TRI_FS = "precision mediump float;\nuniform float u_t;\nvoid main() {\n  gl_FragColor = vec4(0.5 + 0.5 * sin(u_t), 0.5 + 0.5 * sin(u_t + 2.1), 0.5 + 0.5 * sin(u_t + 4.2), 0.9);\n}";

    const QUAD_VS = "attribute vec2 a_pos;\nvarying vec2 v_uv;\nvoid main() {\n  v_uv = (a_pos + 1.0) * 0.5;\n  gl_Position = vec4(a_pos, 0.0, 1.0);\n}";

    const FRAC_FS = "precision highp float;\nvarying vec2 v_uv;\nuniform float u_t;\nuniform float u_iter;\nvoid main() {\n  vec2 c = (v_uv * 3.5 - vec2(2.5, 1.25)) + vec2(sin(u_t * 0.1) * 0.3, cos(u_t * 0.07) * 0.2);\n  vec2 z = vec2(0.0);\n  float n = 0.0;\n  for(float i=0.0; i<512.0; i++) {\n    if (i >= u_iter) break;\n    if (dot(z, z) > 4.0) {\n      n = i;\n      break;\n    }\n    z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;\n    n = i;\n  }\n  float t = n / u_iter;\n  gl_FragColor = vec4(0.5 + 0.5 * sin(t * 6.28 + u_t), 0.5 + 0.5 * sin(t * 6.28 + u_t + 2.1), 0.5 + 0.5 * sin(t * 6.28 + u_t + 4.2), 1.0);\n}";

    const PLASMA_FS = "precision highp float;\nvarying vec2 v_uv;\nuniform float u_t;\nuniform float u_iter;\nvoid main() {\n  vec2 p = v_uv * 8.0;\n  float v = 0.0;\n  float loops = u_iter / 20.0;\n  for(float i=0.0; i<60.0; i++) {\n    if (i >= loops) break;\n    v += sin(p.x + u_t + i) + sin(p.y + u_t * 1.3 + i * 1.1);\n    v += sin((p.x + p.y) * 0.5 + u_t * 0.7 + i * 0.9);\n    v += sin(length(p - vec2(3.0)) + u_t + i);\n  }\n  v /= loops * 4.0;\n  gl_FragColor = vec4(0.5 + 0.5 * sin(v * 3.14 + u_t), 0.5 + 0.5 * sin(v * 3.14 + u_t + 2.1), 0.5 + 0.5 * sin(v * 3.14 + u_t + 4.2), 1.0);\n}";

    /* Build programs */
    let partProg = null, partPosBuf, partColBuf, partSzBuf;
    let triProg = null, triBuf;
    let quadFracProg = null, quadPlasmaProg = null, quadBuf;
    const QUAD_VERTS = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    if (gl) {
        partProg = mkProg(PART_VS, PART_FS);
        partPosBuf = gl.createBuffer();
        partColBuf = gl.createBuffer();
        partSzBuf = gl.createBuffer();

        triProg = mkProg(TRI_VS, TRI_FS);
        triBuf = gl.createBuffer();

        // Create fractal and plasma shaders
        // Some systems don't support highp in fragment shaders. If they fail, ignore gracefully.
        quadFracProg = mkProg(QUAD_VS, FRAC_FS);
        quadPlasmaProg = mkProg(QUAD_VS, PLASMA_FS);
        
        quadBuf = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
        gl.bufferData(gl.ARRAY_BUFFER, QUAD_VERTS, gl.STATIC_DRAW);
    }

    /* State */
    let mode = 'particles';
    let intensity = 5;
    let running = false;
    let benchMode = false;
    let rafId = null;
    let time = 0;
    let lastTs = 0;
    let startTs = 0;
    let benchDur = 30;
    let fpsHistory = [];
    let framesCount = 0;
    let lastFpsTs = 0;
    let ptData = null;
    let triCount = 0;
    const gctx = graphCv ? graphCv.getContext('2d') : null;

    /* Resize canvas */
    function resize() {
        if(!canvas || !graphCv) return;
        const r = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio ? window.devicePixelRatio : 1;
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
        graphCv.width = graphCv.offsetWidth ? graphCv.offsetWidth : 400;
        graphCv.height = 56;
    }
    resize();
    window.addEventListener('resize', resize);

    /* Particle data generator */
    function buildParticles(n) {
        const pos = [], col = [], sz = [], vel = [];
        for (let i = 0; i < n; i++) {
            pos.push(Math.random() * 2 - 1, Math.random() * 2 - 1);
            col.push(Math.random(), Math.random() * 0.5, Math.random());
            sz.push(Math.random() * 4 + 2);
            vel.push((Math.random() - 0.5) * 0.014, (Math.random() - 0.5) * 0.014);
        }
        return { pos: new Float32Array(pos), col: new Float32Array(col), sz: new Float32Array(sz), vel: new Float32Array(vel), n: n };
    }

    function tickParticles() {
        const d = ptData, p = d.pos, v = d.vel, n = d.n;
        for (let i = 0; i < n; i++) {
            p[i * 2] += v[i * 2]; if (p[i * 2] > 1.1) p[i * 2] = -1.1; if (p[i * 2] < -1.1) p[i * 2] = 1.1;
            p[i * 2 + 1] += v[i * 2 + 1]; if (p[i * 2 + 1] > 1.1) p[i * 2 + 1] = -1.1; if (p[i * 2 + 1] < -1.1) p[i * 2 + 1] = 1.1;
        }
    }

    /* Primary render loop */
    function render() {
        if (!running || !gl) { return; }
        const now = performance.now();
        if (!lastTs) lastTs = now;
        if (!lastFpsTs) lastFpsTs = now;
        
        const dt = Math.min((now - lastTs) / 1000, 0.1);
        lastTs = now;
        time += dt;

        /* FPS smoothing and UI updates */
        framesCount++;
        if (now - lastFpsTs >= 1000) {
            const fps = Math.round((framesCount * 1000) / (now - lastFpsTs));
            fpsHistory.push(fps);
            if (fpsHistory.length > 120) fpsHistory.shift();
            
            const avg = Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length);
            const mn = Math.min(...fpsHistory);
            const mx = Math.max(...fpsHistory);

            if(fpsBadge) {
                fpsBadge.textContent = fps + ' FPS';
                fpsBadge.style.color = fps < 20 ? '#ff4f6d' : (fps < 45 ? '#f5a623' : '#00e5aa');
            }
            if(avgFpsEl) avgFpsEl.textContent = avg;
            if(minFpsEl) {
                minFpsEl.textContent = mn;
                minFpsEl.style.color = mn < 20 ? 'red' : 'inherit';
            }
            if(maxFpsEl) maxFpsEl.textContent = mx;
            if(runFps) runFps.textContent = fps + ' FPS';
            
            framesCount = 0;
            lastFpsTs = now;
        }

        /* Update Triangle Count Display */
        const dispCount = mode === 'particles' ? (ptData ? ptData.n : 0) : (mode === 'triangles' ? triCount * 3 : 1);
        if(trisEl) trisEl.textContent = dispCount.toLocaleString();

        /* Update Elapsed Timer */
        const elapsed = (now - startTs) / 1000;
        const hh = Math.floor(elapsed / 3600);
        const mm = Math.floor((elapsed % 3600) / 60);
        const ss = Math.floor(elapsed % 60);
        if(runElapsed) {
            runElapsed.textContent = String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':' + String(ss).padStart(2, '0');
        }

        /* Benchmark Logic */
        if (benchMode) {
            const pct = Math.min((elapsed / benchDur) * 100, 100);
            if(runFill) runFill.style.width = pct + '%';
            if(runPct) runPct.textContent = Math.round(pct) + '%';
            if(runStatus) runStatus.textContent = 'Running';
            
            if (elapsed >= benchDur) { 
                const finalAvg = fpsHistory.length ? Math.round(fpsHistory.reduce((a, b) => a + b, 0) / fpsHistory.length) : 0;
                const finalMn = fpsHistory.length ? Math.min(...fpsHistory) : 0;
                const finalMx = fpsHistory.length ? Math.max(...fpsHistory) : 0;
                endBenchmark(finalAvg, finalMn, finalMx); 
                return; 
            }
        } else {
            if(runStatus) runStatus.textContent = 'Running (Live)';
        }

        /* GL Draw Setup */
        const W = canvas.width, H = canvas.height;
        gl.viewport(0, 0, W, H);
        gl.clearColor(0.04, 0.06, 0.1, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.enable(gl.BLEND);
        
        for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

        /* Draw Mode */
        if (mode === 'particles' && partProg && ptData) {
            tickParticles();
            gl.useProgram(partProg);
            const ap = gl.getAttribLocation(partProg, 'a_pos');
            const ac = gl.getAttribLocation(partProg, 'a_col');
            const az = gl.getAttribLocation(partProg, 'a_sz');
            
            if(ap >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, partPosBuf); gl.bufferData(gl.ARRAY_BUFFER, ptData.pos, gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0); }
            if(ac >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, partColBuf); gl.bufferData(gl.ARRAY_BUFFER, ptData.col, gl.STATIC_DRAW); gl.enableVertexAttribArray(ac); gl.vertexAttribPointer(ac, 3, gl.FLOAT, false, 0, 0); }
            if(az >= 0) { gl.bindBuffer(gl.ARRAY_BUFFER, partSzBuf); gl.bufferData(gl.ARRAY_BUFFER, ptData.sz, gl.STATIC_DRAW); gl.enableVertexAttribArray(az); gl.vertexAttribPointer(az, 1, gl.FLOAT, false, 0, 0); }
            
            gl.drawArrays(gl.POINTS, 0, ptData.n);
            
        } else if (mode === 'triangles' && triProg) {
            gl.useProgram(triProg);
            gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
            const ap = gl.getAttribLocation(triProg, 'a_pos');
            if(ap >= 0) {
                gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
            }
            const ut = gl.getUniformLocation(triProg, 'u_t');
            if(ut) gl.uniform1f(ut, time);
            gl.drawArrays(gl.TRIANGLES, 0, triCount * 3);
            
        } else {
            const prog = mode === 'fractal' ? quadFracProg : quadPlasmaProg;
            if(prog) {
                gl.useProgram(prog);
                gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
                const ap = gl.getAttribLocation(prog, 'a_pos');
                if(ap >= 0) {
                    gl.enableVertexAttribArray(ap); gl.vertexAttribPointer(ap, 2, gl.FLOAT, false, 0, 0);
                }
                const ut = gl.getUniformLocation(prog, 'u_t');
                const uiter = gl.getUniformLocation(prog, 'u_iter');
                if(ut) gl.uniform1f(ut, time);
                if(uiter) gl.uniform1f(uiter, 20.0 + intensity * 22.0);
                gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
            }
        }

        drawGraph();
        rafId = requestAnimationFrame(render);
    }

    /* Graph rendering */
    function drawGraph() {
        if (!gctx || fpsHistory.length < 2) return;
        const W = graphCv.width, H = graphCv.height;
        gctx.clearRect(0, 0, W, H);
        const mx = Math.max(Math.max(...fpsHistory), 60);
        gctx.beginPath();
        fpsHistory.forEach((f, i) => {
            const x = (i / (fpsHistory.length - 1)) * W, y = H - (f / mx) * H;
            i === 0 ? gctx.moveTo(x, y) : gctx.lineTo(x, y);
        });
        gctx.strokeStyle = '#7c6dfa'; gctx.lineWidth = 2; gctx.stroke();
        gctx.lineTo(W, H); gctx.lineTo(0, H); gctx.closePath();
        const g = gctx.createLinearGradient(0, 0, 0, H);
        g.addColorStop(0, 'rgba(124,109,250,0.3)'); g.addColorStop(1, 'rgba(124,109,250,0)');
        gctx.fillStyle = g; gctx.fill();
        gctx.setLineDash([4, 4]); gctx.strokeStyle = 'rgba(0,229,170,0.3)'; gctx.lineWidth = 1;
        gctx.beginPath(); const y60 = H - (60 / mx) * H;
        gctx.moveTo(0, y60); gctx.lineTo(W, y60); gctx.stroke();
        gctx.setLineDash([]);
    }

    /* UI State Switcher */
    function setUI(isRunning) {
        if(startBtn) startBtn.style.display = isRunning ? 'none' : '';
        if(stopBtn) stopBtn.style.display = isRunning ? '' : 'none';
        if(benchBtn) benchBtn.disabled = isRunning;
        
        if (isRunning) {
            if (benchMode) {
              if(intSlider) { intSlider.disabled = true; intSlider.style.opacity = '0.4'; }
              if(benchTimeSel) { benchTimeSel.disabled = true; benchTimeSel.style.opacity = '0.4'; }
            } else {
              if(intSlider) { intSlider.disabled = false; intSlider.style.opacity = '1'; }
              if(benchTimeSel) { benchTimeSel.disabled = false; benchTimeSel.style.opacity = '1'; }
            }
        } else {
            if(intSlider) { intSlider.disabled = false; intSlider.style.opacity = '1'; }
            if(benchTimeSel) { benchTimeSel.disabled = false; benchTimeSel.style.opacity = '1'; }
        }

        if(runPanel) runPanel.classList.toggle('visible', isRunning);
        if (isRunning) {
            if(fpsBadge) fpsBadge.style.display = 'block';
            if(fpsSub) fpsSub.style.display = 'block';
            if(idleMsg) idleMsg.style.display = 'none';
        } else {
            if(fpsBadge) fpsBadge.style.display = 'none';
            if(fpsSub) fpsSub.style.display = 'none';
            if(idleMsg) idleMsg.style.display = 'flex';
        }
    }

    /* Start / Stop Triggers */
    function startTest(bench) {
        if (!gl) return;
        running = true;
        benchMode = bench ? true : false;
        
        if (benchMode) {
          if (benchTimeSel) {
            const v = parseInt(benchTimeSel.value);
            benchDur = v ? v : 30;
          } else {
            benchDur = 30;
          }
        }

        fpsHistory = [];
        framesCount = 0;
        time = 0;
        const now = performance.now();
        lastTs = now;
        lastFpsTs = now;
        startTs = now;
        
        if(benResEl) benResEl.classList.remove('show');
        setUI(true);
        if(runFill) runFill.style.width = '0%';
        if(runPct) runPct.textContent = bench ? '0%' : '';
        if(runStatus) runStatus.textContent = bench ? 'Benchmarking' : 'Running';
        
        if (progContainer) {
            progContainer.style.display = bench ? 'block' : 'none';
        }

        if (mode === 'particles') {
            ptData = buildParticles(intensity * 7000);
        } else if (mode === 'triangles') {
            triCount = intensity * 2500;
            const v = new Float32Array(triCount * 6);
            for (let i = 0; i < triCount; i++) {
                const cx = Math.random() * 2 - 1, cy = Math.random() * 2 - 1;
                const r = Math.random() * 0.14 + 0.02, a = Math.random() * 6.28;
                for (let k = 0; k < 3; k++) {
                    v[i * 6 + k * 2] = cx + Math.cos(a + k * 2.094) * r;
                    v[i * 6 + k * 2 + 1] = cy + Math.sin(a + k * 2.094) * r;
                }
            }
            gl.bindBuffer(gl.ARRAY_BUFFER, triBuf);
            gl.bufferData(gl.ARRAY_BUFFER, v, gl.STATIC_DRAW);
        }

        if(rafId) cancelAnimationFrame(rafId);
        rafId = requestAnimationFrame(render);
    }

    function stopTest() {
        running = benchMode = false;
        if(rafId) cancelAnimationFrame(rafId);
        setUI(false);
        if(runStatus) runStatus.textContent = 'Stopped';
        
        if (gl) {
            gl.clearColor(0.04, 0.06, 0.1, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
    }

    function endBenchmark(avg, mn, mx) {
        stopTest();
        const score = Math.round(avg * intensity * 10);
        if(benScore) benScore.textContent = score.toLocaleString();
        
        let grade = '';
        if (score > 25000) grade = 'Excellent GPU';
        else if (score > 12000) grade = 'Very Good';
        else if (score > 6000) grade = 'Good';
        else if (score > 2000) grade = 'Average';
        else grade = 'Low-End';
        
        if(benGrade) benGrade.textContent = grade;
        if(benDesc) benDesc.textContent = `Avg FPS: ${avg} | Min: ${mn} | Max: ${mx} | Mode: ${mode.charAt(0).toUpperCase() + mode.slice(1)} | Intensity: ${intensity}/10`;
        
        if(benResEl) benResEl.classList.add('show');
        if(runFill) runFill.style.width = '100%'; 
        if(runPct) runPct.textContent = '100%';
        if(runStatus) runStatus.textContent = 'Complete';
        if(runPanel) runPanel.classList.add('visible');
    }

    /* Event Listeners */
    if(startBtn) startBtn.addEventListener('click', () => startTest(false));
    if(stopBtn) stopBtn.addEventListener('click', stopTest);
    if(benchBtn) benchBtn.addEventListener('click', () => startTest(true));

    const modesDiv = document.getElementById('gpu-modes');
    if (modesDiv) {
        modesDiv.addEventListener('click', e => {
            const b = e.target.closest('.gpu-mode-btn');
            if (!b) return;
            mode = b.dataset.mode;
            document.querySelectorAll('.gpu-mode-btn').forEach(x => {
                if(x === b) x.classList.add('active');
                else x.classList.remove('active');
            });
            if (running) { stopTest(); startTest(benchMode); }
        });
    }

    if(intSlider) {
        intSlider.addEventListener('input', () => {
            intensity = +intSlider.value;
            if(intValEl) intValEl.textContent = intensity + ' / 10';
            if (running && !benchMode) {
                stopTest(); startTest(benchMode); 
            }
        });
    }

})();
