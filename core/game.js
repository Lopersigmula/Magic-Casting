// Мини-игра: Canvas-отрисовка, ввод (touch/mouse/pen через Pointer Events), ход заклинания
// и визуальные эффекты ауры (облака, «грязь» от линии, частицы, кольца, дрожание, звук).
import { evaluateStroke, pathLength, pointAt, dist, REASON_TEXT } from './recognizer.js';
import { buildAura, buildRamp, makeSprite, rgbStr, KIND, RAMP_N } from './aura.js';
import * as sfx from './fx.js';

const C = { cyan: '#5ee7ff', violet: '#a78bfa', teal: '#2dd4bf', red: '#ff5d73', dim: 'rgba(130,160,230,0.28)' };
const SM = 0.5;   // масштаб слоя «грязи» (полвысоты/полширины экрана)
const rnd = (a, b) => a + Math.random() * (b - a);
const mod = (i, n = RAMP_N) => ((Math.round(i) % n) + n) % n;
const wrapDiff = d => ((d + RAMP_N / 2) % RAMP_N + RAMP_N) % RAMP_N - RAMP_N / 2;

export class Game {
    constructor(canvas, cb) {
        this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cb = cb;
        this.w = 0; this.h = 0; this.dpr = 1; this.u = 1;
        this.session = null; this.running = false; this.paused = false; this.finished = true; this.lock = false;
        this.trail = []; this.drawing = false; this.pid = null; this.flash = null;
        this.raf = 0; this.last = 0; this.tickAcc = 0; this.timeouts = new Set();
        // эффекты
        this.fxL = 2; this.aura = null; this.ramp = []; this.rgbs = []; this.sprites = []; this.white = null;
        this.parts = []; this.cloud = []; this.rings = []; this.sweeps = []; this.segs = []; this.shakes = [];
        this.sflash = null; this.smA = null; this.smB = null; this.smLife = 0;
        this.pigment = 0; this.travel = 0; this.trailLen = 0; this.mvAcc = 0; this.speed = 0;
        this.sealT = 0; this.sealDur = 0; this.lastSec = -1; this.live = 0; this.prog = 0; this.shiver = 0; this.shakeOn = true;

        const stop = e => e.preventDefault();
        canvas.addEventListener('touchstart', stop, { passive: false });
        canvas.addEventListener('touchmove', stop, { passive: false });
        canvas.addEventListener('contextmenu', stop);
        canvas.addEventListener('pointerdown', e => this.down(e));
        canvas.addEventListener('pointermove', e => this.move(e));
        canvas.addEventListener('pointerup', e => this.up(e));
        canvas.addEventListener('pointercancel', e => this.up(e));
        this.ro = new ResizeObserver(() => this.resize());
        this.ro.observe(canvas.parentElement);
    }

    get anim() { return this.session?.opts.anim || 'full'; }
    get sym() { return this.session.symbols[this.symIdx]; }

    resize() {
        const r = this.canvas.parentElement.getBoundingClientRect();
        if (r.width < 10 || r.height < 10) return;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.w = r.width; this.h = r.height;
        this.canvas.width = Math.round(r.width * this.dpr);
        this.canvas.height = Math.round(r.height * this.dpr);
        this.bs = Math.min(this.w, this.h) * 0.86;
        this.bx = (this.w - this.bs) / 2; this.by = (this.h - this.bs) / 2;
        this.u = this.bs / 340;
        this.allocSmudge();
        if (this.session && this.ramp.length) this.makeCloud();
        this.render();
    }

    px(p) { return [this.bx + p[0] * this.bs, this.by + p[1] * this.bs]; }
    norm(e) {
        const r = this.canvas.getBoundingClientRect();
        return [(e.clientX - r.left - this.bx) / this.bs, (e.clientY - r.top - this.by) / this.bs];
    }
    later(fn, ms) { const t = setTimeout(() => { this.timeouts.delete(t); fn(); }, ms); this.timeouts.add(t); }

    /* ---------- подготовка эффектов ---------- */
    setupFx(session) {
        this.fxL = this.anim === 'full' ? 2 : this.anim === 'reduced' ? 1 : 0;
        this.shakeOn = session.opts.shake !== false && this.fxL > 0;
        this.aura = session.params.aura || buildAura(null, '', session.params.difficulty);
        this.ramp = buildRamp(this.aura.colors);
        this.rgbs = this.ramp.map(rgbStr);
        this.sprites = this.fxL ? this.ramp.map(c => makeSprite(c)) : [];
        this.white = this.fxL ? makeSprite([255, 255, 255]) : null;
        this.parts = []; this.rings = []; this.sweeps = []; this.segs = []; this.shakes = [];
        this.sflash = null; this.smLife = 0; this.travel = 0; this.trailLen = 0; this.mvAcc = 0; this.speed = 0;
        this.pigment = Math.random() * RAMP_N; this.sealT = 0; this.sealDur = 0; this.lastSec = -1;
        this.live = 0; this.prog = 0; this.shiver = 0;
    }
    allocSmudge() {
        if (!this.fxL) { this.smA = this.smB = null; return; }
        const W = Math.max(8, Math.round(this.w * SM)), H = Math.max(8, Math.round(this.h * SM));
        const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'); g.globalCompositeOperation = 'lighter'; return { c, g }; };
        this.smA = mk(); this.smB = mk();
    }
    makeCloud() {
        this.cloud = [];
        if (!this.fxL || !this.w) return;
        const n = this.fxL === 2 ? 12 : 7, cx = this.w / 2, cy = this.h / 2;
        for (let i = 0; i < n; i++) {
            const ang = (i / n) * Math.PI * 2 + rnd(-0.3, 0.3), rad = this.bs * rnd(0.12, 0.42);
            const home = (i % 3) * (RAMP_N / 3) + rnd(-1.2, 1.2), hx = cx + Math.cos(ang) * rad, hy = cy + Math.sin(ang) * rad;
            this.cloud.push({ hx, hy, x: hx, y: hy, vx: 0, vy: 0, r: this.bs * rnd(0.17, 0.3), ci: home, home, heat: 0, ph: rnd(0, 6.28) });
        }
        // фоновые частицы ауры
        this.parts = this.parts.filter(p => !p.amb);
        const na = this.fxL === 2 ? Math.round(34 + 40 * this.aura.energy) : 16;
        for (let i = 0; i < na; i++) { const p = this.spawn(0, 0, 0, 0, this.aura.particle, rnd(0, RAMP_N)); p.amb = true; this.respawnAmb(p, true); this.parts.push(p); }
    }

    /* ---------- управление ---------- */
    start(session) {
        this.clearTimers();
        this.session = session;
        const p = session.params;
        this.setupFx(session);
        this.symIdx = 0; this.strokeIdx = 0; this.mistakes = 0; this.scores = []; this.strokeAcc = [];
        this.elapsed = 0; this.timeLeft = p.time_limit || 0; this.started = false; this.finished = false; this.lock = false;
        this.done = []; this.trail = []; this.flash = null; this.appearT = 0; this.paused = false; this.drawing = false;
        this.resize();
        if (!this.cloud.length) this.makeCloud();
        sfx.startCast(this.aura);
        this.cb.onSymbol(this.info());
        this.loop(performance.now(), true);
    }
    restart() { if (this.session) this.start(this.session); }
    cancel() { if (!this.finished) this.finish('cancel', 'cancel'); }
    destroy() { this.clearTimers(); cancelAnimationFrame(this.raf); this.ro.disconnect(); sfx.drawStop(); sfx.stopCast(true); }
    clearTimers() { this.timeouts.forEach(clearTimeout); this.timeouts.clear(); }
    setPaused(v) {
        this.paused = v;
        if (this.drawing) { this.drawing = false; this.trail = []; sfx.drawStop(); }
        if (v) sfx.stopCast(true);
        else if (!this.finished) { sfx.startCast(this.aura); this.loop(performance.now(), true); }
    }
    info() {
        const p = this.session.params;
        return { symIdx: this.symIdx, symTotal: this.session.symbols.length, name: this.sym.name,
            strokes: this.sym.strokes.length, allowed: p.allowed_mistakes, mistakes: this.mistakes,
            timeLeft: this.timeLeft, limit: p.time_limit };
    }

    /* ---------- ввод ---------- */
    down(e) {
        if (this.finished || this.paused || this.lock || this.drawing || !e.isPrimary) return;
        e.preventDefault();
        this.drawing = true; this.pid = e.pointerId;
        this.trail = [this.norm(e)]; this.trailLen = 0; this.segs = [];
        this.pigment = (this.pigment + RAMP_N / 3 + rnd(-0.8, 0.8)) % RAMP_N;   // новый штрих — новый «пигмент»
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
        this.started = true;
        sfx.drawStart();
    }
    move(e) {
        if (!this.drawing || e.pointerId !== this.pid) return;
        e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of (evs.length ? evs : [e])) {
            const p = this.norm(ev), l = this.trail[this.trail.length - 1], d = dist(p, l);
            if (d > 0.004) {
                this.trail.push(p); this.trailLen += d; this.mvAcc += d;
                if (this.fxL && this.segs.length < 60) this.segs.push([this.px(l), this.px(p)]);
            }
        }
    }
    up(e) {
        if (!this.drawing || e.pointerId !== this.pid) return;
        this.drawing = false;
        sfx.drawStop();
        try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ok */ }
        this.finishStroke();
    }

    /* ---------- ход игры ---------- */
    finishStroke() {
        const trail = this.trail; this.trail = []; this.segs = [];
        if (trail.length < 5 || pathLength(trail) < 0.05) return;   // случайное касание — не ошибка
        const sym = this.sym, stroke = sym.strokes[this.strokeIdx], p = this.session.params;
        const res = evaluateStroke(trail, stroke.prep, { tol: p.drawing_tolerance, strictness: this.session.opts.strictness, tolMul: (sym.tolMul || 1) * (1 + (this.session.opts.tierEase || 0) * ((sym.tier || 1) - 1) / 4) });
        if (res.ok) {
            this.strokeAcc.push(res.accuracy);
            this.done.push(trail);
            this.strokeIdx++;
            const end = this.px(stroke.prep.end);
            this.burst(end, this.pigment, 14, 150);
            this.ring(end[0], end[1], this.pigment, this.bs * 0.14, 0.55, 3);
            this.sweep(stroke.prep);
            sfx.stroke(res.accuracy);
            this.cb.onFeedback({ ok: true, accuracy: res.accuracy, text: res.accuracy > 0.8 ? 'Отлично!' : 'Принято' });
            if (this.strokeIdx >= sym.strokes.length) {
                const acc = this.strokeAcc.reduce((a, b) => a + b, 0) / sym.strokes.length;
                this.scores.push(acc);
                this.cb.onSymbolDone({ index: this.symIdx, accuracy: acc });
                this.seal();
            }
        } else {
            this.mistakes++;
            this.flash = { t: performance.now(), pts: trail };
            this.shakes.push({ t0: performance.now(), dur: 300, amp: 0.7 });
            sfx.error();
            this.cb.onFeedback({ ok: false, accuracy: res.accuracy, text: REASON_TEXT[res.reason] || 'Ошибка' });
            if (this.mistakes > p.allowed_mistakes) this.fizzle('mistakes');
            else this.cb.onSymbol(this.info());
        }
    }
    /** Символ завершён: вспышка, кольца и лёгкое затухающее дрожание. */
    seal() {
        const final = this.symIdx >= this.session.symbols.length - 1, now = performance.now(), cx = this.w / 2, cy = this.h / 2;
        this.sealDur = this.fxL ? (final ? 1000 : 800) : 0;
        this.sealT = now;
        if (this.fxL) {
            this.burst([cx, cy], this.pigment, this.fxL === 2 ? 44 : 20, 260);
            this.ring(cx, cy, this.pigment, this.bs * 0.6, 0.8, 5);
            this.ring(cx, cy, this.pigment + 5, this.bs * 0.42, 0.65, 3);
            if (final) this.ring(cx, cy, this.pigment + 10, this.bs * 0.9, 1.0, 6);
            this.sflash = { t0: now, dur: final ? 700 : 450, ci: this.pigment, a: final ? 0.4 : 0.28 };
            if (this.shakeOn) {
                this.shakes.push({ t0: now, dur: this.sealDur, amp: 1 });
                if (navigator.vibrate) navigator.vibrate([18, 40, 14, 40, 10]);
            }
        }
        sfx.symbol(this.symIdx, final);
        if (this.shakeOn) sfx.tremble(this.sealDur / 1000);
        this.lock = true;
        this.later(() => this.nextSymbol(), this.fxL ? this.sealDur : 120);
    }
    /** Заклинание срывается: красная вспышка, схлопывание, затем итог. */
    fizzle(reason) {
        if (this.lock || this.finished) return;
        this.lock = true;
        if (this.drawing) { this.drawing = false; sfx.drawStop(); }
        sfx.fail();
        if (this.fxL) {
            const cx = this.w / 2, cy = this.h / 2;
            this.flash = { t: performance.now(), pts: this.trail.length > 1 ? this.trail : this.sym.strokes[0].prep.pts.map(q => q) };
            for (let i = 0; i < 26; i++) { const a = Math.random() * 6.28, d = this.bs * rnd(0.2, 0.5); this.emit(cx + Math.cos(a) * d, cy + Math.sin(a) * d, -Math.cos(a) * 160 * this.u, -Math.sin(a) * 160 * this.u, 'spark', this.pigment); }
            this.ring(cx, cy, this.pigment, this.bs * 0.5, 0.45, 4, true);
            this.sflash = { t0: performance.now(), dur: 400, ci: this.pigment, a: 0.22, red: true };
            if (this.shakeOn) this.shakes.push({ t0: performance.now(), dur: 450, amp: 1.2 });
        }
        this.later(() => this.finish('failed', reason), this.fxL ? 450 : 0);
    }
    nextSymbol() {
        this.lock = false;
        this.symIdx++;
        if (this.symIdx >= this.session.symbols.length) { this.symIdx--; this.finish('done', 'done'); return; }
        this.strokeIdx = 0; this.strokeAcc = []; this.done = []; this.appearT = 0;
        this.cb.onSymbol(this.info());
    }
    finish(kind, reason) {
        if (this.finished) return;
        this.finished = true; this.drawing = false; this.clearTimers();
        sfx.drawStop(); sfx.stopCast();
        const scores = this.scores.slice();
        if (kind !== 'done' && this.strokeAcc.length) {
            scores.push(this.strokeAcc.reduce((a, b) => a + b, 0) / this.sym.strokes.length);
        }
        this.cb.onFinish({ kind, reason, scores, mistakes: this.mistakes, elapsed: this.elapsed,
            symbolsDone: this.scores.length, symbolsTotal: this.session.symbols.length });
        this.render();
    }

    /* ---------- цикл ---------- */
    loop(ts, first) {
        cancelAnimationFrame(this.raf);
        if (this.finished || this.paused) return;
        const dt = first ? 0 : Math.min(0.1, (ts - this.last) / 1000);
        this.last = ts;
        if (this.started && !this.lock) {
            this.elapsed += dt;
            if (this.timeLeft > 0 || this.session.params.time_limit > 0) {
                this.timeLeft = Math.max(0, this.timeLeft - dt);
                const sec = Math.ceil(this.timeLeft);
                if (sec <= 5 && sec > 0 && sec !== this.lastSec) sfx.tick();
                this.lastSec = sec;
                if (this.timeLeft <= 0) this.fizzle('timeout');
            }
        }
        this.appearT = Math.min(1, this.appearT + dt * (this.anim === 'off' ? 20 : 2.5));
        this.update(dt, ts);
        this.tickAcc += dt;
        if (this.tickAcc > 0.1) {
            this.tickAcc = 0;
            const sym = this.sym;
            this.cb.onTick({ timeLeft: this.timeLeft, elapsed: this.elapsed,
                progress: Math.min(1, (this.strokeIdx + this.live) / sym.strokes.length) });
            sfx.setIntensity(this.prog);
        }
        this.render(ts);
        this.raf = requestAnimationFrame(t => this.loop(t));
    }

    /** Общее состояние кадра: прогресс, дрожь, звук рисования и все системы эффектов. */
    update(dt, ts) {
        const sym = this.sym, st = sym.strokes[this.strokeIdx];
        this.live = this.drawing && st ? Math.min(1, this.trailLen / st.prep.length) : 0;
        this.prog = Math.min(1, (this.symIdx + (this.strokeIdx + this.live) / sym.strokes.length) / this.session.symbols.length);
        const last = this.strokeIdx === sym.strokes.length - 1;
        // нарастающая дрожь в конце последнего штриха символа
        this.shiver = this.drawing && last && this.live > 0.7 ? Math.pow(Math.min(1, (this.live - 0.7) / 0.3), 1.5) : 0;
        // скорость пальца (доли поля в секунду)
        const sp = dt > 0 ? this.mvAcc / dt : 0; this.mvAcc = 0;
        this.speed += (sp - this.speed) * Math.min(1, dt * 12);
        if (this.drawing) sfx.drawMove(this.speed, this.live, this.shiver);
        if (!this.fxL) return;
        this.processSegs(dt);
        this.updateParts(dt, ts);
        this.updateCloud(dt, ts);
        this.updateSmudge(dt, ts);
        this.updateRings(dt);
    }

    /* ---------- частицы ---------- */
    spawn(x, y, vx, vy, kind, ci) {
        const K = KIND[kind];
        return { x, y, vx, vy, life: 1, decay: 1 / rnd(K.life[0], K.life[1]), size: rnd(K.size[0], K.size[1]), ci, kind,
            rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * (K.spin || 0) * 2, seed: Math.random(), amb: false };
    }
    capFull() { return this.parts.length > (this.fxL === 2 ? 380 : 150); }
    emit(x, y, vx, vy, kind, ci) { if (!this.capFull()) this.parts.push(this.spawn(x, y, vx, vy, kind, ci)); }
    respawnAmb(p, first) {
        const cx = this.w / 2, cy = this.h / 2;
        p.x = cx + rnd(-0.55, 0.55) * this.bs; p.y = cy + rnd(-0.55, 0.55) * this.bs;
        p.vx = rnd(-8, 8) * this.u; p.vy = rnd(-8, 8) * this.u;
        p.life = first ? rnd(0.1, 1) : 1; p.decay = 1 / rnd(3, 6); p.ci = mod(p.ci + rnd(-3, 3));
    }
    burst(at, ci, n, speed) {
        if (!this.fxL) return;
        const cnt = this.fxL === 2 ? n : Math.ceil(n / 2);
        for (let i = 0; i < cnt; i++) {
            const a = Math.random() * Math.PI * 2, v = (40 + Math.random() * speed) * this.u;
            this.emit(at[0], at[1], Math.cos(a) * v, Math.sin(a) * v, Math.random() < 0.65 ? this.aura.particle : 'spark', ci + rnd(-3, 3));
        }
    }
    ring(x, y, ci, r1, dur, w, red) { if (this.fxL) this.rings.push({ x, y, ci, r1, t: 0, dur, w, red }); }
    sweep(prep) { if (this.fxL) this.sweeps.push({ prep, t: 0, dur: 0.55, ci: this.pigment }); }

    /** Линия пальца: оставляет «грязь» в слое, роняет частицы и расталкивает/перекрашивает ауру. */
    processSegs(dt) {
        if (!this.segs.length) return;
        const segs = this.segs.length > 24 ? this.segs.slice(-24) : this.segs; this.segs = [];
        const rate = (this.fxL === 2 ? 0.22 : 0.1) * (0.6 + 0.8 * this.aura.energy), u = this.u;
        for (const [a, b] of segs) {
            const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
            if (len < 0.5) continue;
            const ux = dx / len, uy = dy / len;
            this.travel += len;
            const ci = this.pigment + (this.travel / (this.bs * 0.9)) * 4;
            // слой «грязи»
            for (let d = 0; d < len; d += 5) this.stamp(a[0] + ux * d, a[1] + uy * d, ci);
            // частицы, падающие с линии
            const n = Math.min(4, Math.floor(len * rate + Math.random()));
            for (let i = 0; i < n; i++) {
                const t = Math.random() * len, kind = Math.random() < 0.3 ? 'spark' : this.aura.particle;
                this.emit(a[0] + ux * t, a[1] + uy * t, (-ux * rnd(10, 40) + rnd(-30, 30)) * u, (-uy * rnd(10, 40) + rnd(-30, 30)) * u, kind, ci + rnd(-2, 2));
            }
            // облака ауры: толкаем вдоль линии и красим пигментом
            for (const bl of this.cloud) {
                const d = this.segDist(bl.x, bl.y, a, ux, uy, len), R = bl.r * 0.9;
                if (d < R) {
                    const k = 1 - d / R;
                    bl.vx += ux * len * k; bl.vy += uy * len * k;
                    bl.ci += wrapDiff(ci - bl.ci) * 0.25 * k; bl.heat = Math.min(1, bl.heat + k * 0.3);
                }
            }
            // фоновые частицы: подхватываются линией и окрашиваются
            const R = this.bs * 0.12;
            for (const p of this.parts) {
                if (!p.amb) continue;
                const d = this.segDist(p.x, p.y, a, ux, uy, len);
                if (d < R) { const k = 1 - d / R; p.vx += ux * len * 0.6 * k * u * 4; p.vy += uy * len * 0.6 * k * u * 4; p.ci += wrapDiff(ci - p.ci) * 0.5 * k; }
            }
        }
    }
    segDist(px, py, a, ux, uy, len) {
        const t = Math.max(0, Math.min(len, (px - a[0]) * ux + (py - a[1]) * uy));
        return Math.hypot(px - (a[0] + ux * t), py - (a[1] + uy * t));
    }
    stamp(x, y, ci) {
        if (!this.smA) return;
        const r = this.bs * SM * (0.045 + Math.random() * 0.05) * (0.7 + this.aura.smudge * 0.6);
        const g = this.smA.g;
        g.globalAlpha = 0.1 * (0.6 + this.aura.smudge * 0.6) * (this.fxL === 2 ? 1 : 0.7);
        g.drawImage(this.sprites[mod(ci)], x * SM - r, y * SM - r, r * 2, r * 2);
        this.smLife = 3;
    }
    updateSmudge(dt, ts) {
        if (!this.smA) return;
        if (this.smLife <= 0) return;
        this.smLife -= dt;
        const K = KIND[this.aura.particle], A = this.smA, B = this.smB;
        const dx = (K.drift[0] + Math.sin(ts * 0.0007) * 6 * this.aura.turbulence) * dt * SM * this.u;
        const dy = (K.drift[1] + Math.cos(ts * 0.0009) * 6 * this.aura.turbulence) * dt * SM * this.u;
        B.g.globalCompositeOperation = 'source-over';
        B.g.clearRect(0, 0, B.c.width, B.c.height);
        B.g.globalAlpha = Math.pow(0.5, dt / 1.6);   // период полураспада «грязи» ≈ 1.6 с
        B.g.drawImage(A.c, dx, dy);
        B.g.globalAlpha = 1; B.g.globalCompositeOperation = 'lighter';
        this.smA = B; this.smB = A;
    }
    updateCloud(dt, ts) {
        const damp = Math.exp(-1.6 * dt);
        for (const b of this.cloud) {
            b.vx += (b.hx - b.x) * 2.2 * dt + Math.sin(ts * 0.0006 + b.ph) * 6 * dt * this.u;
            b.vy += (b.hy - b.y) * 2.2 * dt + Math.cos(ts * 0.0005 + b.ph) * 6 * dt * this.u;
            b.vx *= damp; b.vy *= damp; b.x += b.vx * dt; b.y += b.vy * dt;
            b.heat = Math.max(0, b.heat - dt * 0.5);
            b.ci += wrapDiff(b.home - b.ci) * 0.12 * dt;   // аура медленно «отмывается»
        }
    }
    updateParts(dt, ts) {
        const arr = this.parts, turb = this.aura.turbulence, u = this.u;
        for (let i = arr.length - 1; i >= 0; i--) {
            const p = arr[i], K = KIND[p.kind];
            p.life -= dt * p.decay;
            if (p.life <= 0) {
                if (p.amb) this.respawnAmb(p); else { arr[i] = arr[arr.length - 1]; arr.pop(); continue; }
            }
            p.vy += K.g * (p.amb ? 0.35 : 1) * dt * u;
            p.vx += Math.sin(p.y * 0.03 + ts * 0.0012 + p.seed * 6) * turb * 40 * u * dt;
            p.vy += Math.cos(p.x * 0.03 + ts * 0.001 + p.seed * 9) * turb * 20 * u * dt;
            const dr = Math.exp(-K.drag * dt); p.vx *= dr; p.vy *= dr;
            p.x += p.vx * dt; p.y += p.vy * dt; p.rot += p.vr * dt;
        }
    }
    updateRings(dt) {
        this.rings = this.rings.filter(r => (r.t += dt / r.dur) < 1);
        this.sweeps = this.sweeps.filter(s => (s.t += dt / s.dur) < 1);
        if (this.sflash && performance.now() - this.sflash.t0 > this.sflash.dur) this.sflash = null;
    }

    /* ---------- дрожание ---------- */
    shakeOffset() {
        const now = performance.now();
        this.shakes = this.shakes.filter(s => now - s.t0 < s.dur);
        let amp = 0;
        for (const s of this.shakes) { const k = 1 - (now - s.t0) / s.dur; amp = Math.max(amp, s.amp * k * k); }
        if (this.shiver > 0) amp = Math.max(amp, this.shiver * 0.5);
        this.amp = this.shakeOn ? amp : 0;
        if (this.amp < 0.01) return [0, 0];
        const a = this.amp * this.bs * 0.009 * (this.fxL === 2 ? 1 : 0.5);
        return [(Math.sin(now * 0.083) * 0.6 + Math.sin(now * 0.131 + 2) * 0.4 + (Math.random() - 0.5) * 0.8) * a,
            (Math.sin(now * 0.097 + 1) * 0.6 + Math.sin(now * 0.151) * 0.4 + (Math.random() - 0.5) * 0.8) * a];
    }

    /* ---------- отрисовка ---------- */
    path(pts) {
        const c = this.ctx; c.beginPath();
        pts.forEach((p, i) => { const q = this.px(p); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
    }
    line(pts, color, width, glow, alpha = 1, dash, offset = 0) {
        const c = this.ctx;
        c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width;
        c.lineCap = 'round'; c.lineJoin = 'round';
        if (dash) { c.setLineDash(dash); c.lineDashOffset = offset; }
        if (glow && this.anim === 'full') { c.shadowColor = color; c.shadowBlur = glow; }
        this.path(pts); c.stroke(); c.restore();
    }
    sp(ci) { return this.sprites[mod(ci)]; }

    render(ts = performance.now()) {
        const c = this.ctx;
        if (!this.w) return;
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.clearRect(0, 0, this.w, this.h);
        if (!this.session) return;
        const fx = this.fxL, bs = this.bs, lw = Math.max(3, bs * 0.016), a = this.appearT;
        const [sx, sy] = this.shakeOffset();

        c.save(); c.translate(sx, sy);
        if (fx) this.drawAura(c, ts);

        // тонкая рамка поля символа
        c.save(); c.strokeStyle = 'rgba(120,150,255,0.18)'; c.lineWidth = 1;
        c.strokeRect(this.bx, this.by, bs, bs); c.restore();

        const sym = this.sym, jit = this.amp > 0.01 ? this.amp * bs * 0.004 : 0;
        const sealK = this.sealT ? 1 - (ts - this.sealT) / 450 : 0;
        sym.strokes.forEach((st, i) => {
            c.save();
            if (jit) c.translate((Math.random() - 0.5) * 2 * jit, (Math.random() - 0.5) * 2 * jit);
            if (i < this.strokeIdx) {
                if (fx) {
                    this.line(st.prep.pts, this.rgbs[mod(this.pigment - 2 * (this.strokeIdx - i))], lw * 1.1, 16, 0.95);
                    this.line(st.prep.pts, '#ffffff', lw * 0.45, 0, 0.5 + 0.25 * Math.sin(ts / 260 + i), [bs * 0.02, bs * 0.05], -ts * 0.04);
                    if (sealK > 0) this.line(st.prep.pts, '#ffffff', lw * 1.7, 20, Math.min(1, sealK) * 0.9);
                } else this.line(st.prep.pts, C.teal, lw, 14, 0.9);
            } else if (i === this.strokeIdx) this.line(st.prep.pts, C.cyan, lw, 10, 0.38 * a, [bs * 0.03, bs * 0.02], fx ? -ts * 0.02 : 0);
            else this.line(st.prep.pts, C.dim, lw * 0.8, 0, a, [bs * 0.02, bs * 0.03]);
            c.restore();
        });

        const cur = sym.strokes[this.strokeIdx];
        if (cur && !this.finished) {
            const pp = cur.prep, s0 = this.px(pp.start);
            const pulse = this.anim === 'off' ? 1 : 1 + 0.25 * Math.sin(ts / 220);
            if (fx && !this.drawing) {   // расходящаяся рябь на старте штриха
                const k = (ts % 1400) / 1400;
                c.save(); c.globalCompositeOperation = 'lighter'; c.globalAlpha = (1 - k) * 0.6 * a;
                c.strokeStyle = this.rgbs[mod(this.pigment + 4)]; c.lineWidth = 1.5;
                c.beginPath(); c.arc(s0[0], s0[1], lw * (2 + k * 7), 0, 7); c.stroke(); c.restore();
            }
            c.save(); c.fillStyle = C.violet;
            if (this.anim === 'full') { c.shadowColor = C.violet; c.shadowBlur = 16; }
            c.globalAlpha = a; c.beginPath(); c.arc(s0[0], s0[1], lw * 2.1 * pulse, 0, 7); c.fill(); c.restore();
            // стрелка направления
            const d1 = pointAt(pp.pts, pp.cum, 0.07), q = this.px(d1);
            const ang = Math.atan2(q[1] - s0[1], q[0] - s0[0]), ah = lw * 3.4;
            c.save(); c.translate(q[0], q[1]); c.rotate(ang); c.fillStyle = C.cyan; c.globalAlpha = a;
            c.beginPath(); c.moveTo(ah, 0); c.lineTo(-ah * 0.6, -ah * 0.7); c.lineTo(-ah * 0.6, ah * 0.7); c.closePath(); c.fill(); c.restore();
            // бегущая точка-подсказка
            if (this.anim !== 'off' && !this.drawing) {
                const t = ((ts * 0.00035 * this.session.params.trace_speed) % 1.5);
                const tp = this.px(pointAt(pp.pts, pp.cum, Math.min(1, t)));
                c.save(); c.globalAlpha = Math.max(0, 1 - Math.max(0, t - 1) * 3) * a; c.fillStyle = '#fff';
                c.beginPath(); c.arc(tp[0], tp[1], lw * 1.2, 0, 7); c.fill(); c.restore();
            }
        }

        this.done.forEach(t => this.line(t, fx ? this.rgbs[mod(this.pigment)] : C.violet, lw * 0.7, 0, 0.35));
        if (fx) this.drawSweeps(c, lw);
        if (this.trail.length > 1) { if (fx) this.drawTrail(c, ts, lw); else this.line(this.trail, '#ffffff', lw * 1.1, 14); }
        if (this.flash) {
            const k = 1 - (ts - this.flash.t) / 450;
            if (k > 0 && this.anim !== 'off') this.line(this.flash.pts, C.red, lw * 1.1, 10, k);
            else this.flash = null;
        }
        if (fx) { this.drawParts(c, ts); this.drawRings(c); }
        c.restore();

        if (fx) this.drawOverlay(c, ts);
    }

    /** Фон ауры: общее свечение, облака (их размазывает линия), слой «грязи», орбитальные кольца. */
    drawAura(c, ts) {
        const cx = this.w / 2, cy = this.h / 2, bs = this.bs, p = this.prog;
        c.save(); c.globalCompositeOperation = 'lighter';
        const R = bs * (0.7 + 0.08 * Math.sin(ts / 700));
        c.globalAlpha = (0.10 + 0.22 * p) * (0.85 + 0.15 * Math.sin(ts / 500));
        c.drawImage(this.sp(0), cx - R, cy - R, R * 2, R * 2);
        for (const b of this.cloud) {
            const r = b.r * (1 + 0.06 * Math.sin(ts / 900 + b.ph));
            c.globalAlpha = 0.11 + 0.18 * b.heat;
            c.drawImage(this.sp(b.ci), b.x - r, b.y - r, r * 2, r * 2);
        }
        if (this.smA && this.smLife > 0) { c.globalAlpha = 0.9; c.drawImage(this.smA.c, 0, 0, this.w, this.h); }
        // орбитальные кольца: чем ближе финал, тем ярче и быстрее
        const spin = ts * 0.0008 * (1 + p * 2);
        c.lineWidth = 1.5; c.strokeStyle = this.rgbs[0];
        c.globalAlpha = 0.15 + 0.35 * p; c.setLineDash([bs * 0.02, bs * 0.035]); c.lineDashOffset = -ts * 0.01 * (1 + p * 3);
        c.beginPath(); c.arc(cx, cy, bs * 0.52, 0, 7); c.stroke();
        c.strokeStyle = this.rgbs[mod(RAMP_N / 3)]; c.globalAlpha = 0.1 + 0.3 * p; c.setLineDash([2, bs * 0.03]); c.lineDashOffset = ts * 0.008;
        c.beginPath(); c.arc(cx, cy, bs * 0.47, 0, 7); c.stroke(); c.setLineDash([]);
        for (let k = 0; k < 3; k++) {
            const ang = spin + (k * Math.PI * 2) / 3, s = bs * 0.05;
            c.globalAlpha = 0.5 + 0.4 * p;
            c.drawImage(this.sp(k * 5.33), cx + Math.cos(ang) * bs * 0.52 - s, cy + Math.sin(ang) * bs * 0.52 - s, s * 2, s * 2);
        }
        c.restore();
    }

    /** След пальца: разноцветная лента с сужающимся хвостом, белое ядро и «комета» на кончике. */
    drawTrail(c, ts, lw) {
        const t = this.trail, n = t.length, P = t.map(p => this.px(p)), chunk = Math.max(2, Math.ceil(n / 60));
        c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.globalCompositeOperation = 'lighter';
        for (let s = 0; s < n - 1; s += chunk) {
            const e = Math.min(n - 1, s + chunk), k = 0.3 + 0.7 * (e / (n - 1));
            c.beginPath(); c.moveTo(P[s][0], P[s][1]);
            for (let i = s + 1; i <= e; i++) c.lineTo(P[i][0], P[i][1]);
            c.strokeStyle = this.rgbs[mod(this.pigment + e * 0.08)];
            c.globalAlpha = 0.2; c.lineWidth = lw * 4.4 * k; c.stroke();
            c.globalAlpha = 0.55; c.lineWidth = lw * 2 * k; c.stroke();
        }
        c.globalCompositeOperation = 'source-over'; c.globalAlpha = 0.95; c.strokeStyle = '#fff'; c.lineWidth = lw;
        if (this.anim === 'full') { c.shadowColor = this.rgbs[mod(this.pigment)]; c.shadowBlur = 14; }
        c.beginPath(); c.moveTo(P[0][0], P[0][1]); for (let i = 1; i < n; i++) c.lineTo(P[i][0], P[i][1]); c.stroke();
        c.shadowBlur = 0; c.globalCompositeOperation = 'lighter';
        const h = P[n - 1], pl = 1 + 0.15 * Math.sin(ts / 90), R = lw * 9 * pl;
        c.globalAlpha = 0.85; c.drawImage(this.sp(this.pigment), h[0] - R, h[1] - R, R * 2, R * 2);
        c.globalAlpha = 1; c.drawImage(this.white, h[0] - lw * 3.2, h[1] - lw * 3.2, lw * 6.4, lw * 6.4);
        c.restore();
    }
    drawSweeps(c, lw) {
        for (const s of this.sweeps) {
            const f = 1 - Math.pow(1 - s.t, 2), f0 = Math.max(0, f - 0.18), pts = [];
            for (let i = 0; i <= 10; i++) pts.push(pointAt(s.prep.pts, s.prep.cum, f0 + (f - f0) * i / 10));
            this.line(pts, '#ffffff', lw * 1.8, 18, 1 - s.t * 0.6);
        }
    }
    drawRings(c) {
        c.save(); c.globalCompositeOperation = 'lighter';
        for (const r of this.rings) {
            const k = 1 - Math.pow(1 - r.t, 3);
            c.globalAlpha = Math.pow(1 - r.t, 1.5) * 0.9; c.lineWidth = Math.max(0.5, r.w * (1 - r.t));
            c.strokeStyle = r.red ? C.red : this.rgbs[mod(r.ci)];
            c.beginPath(); c.arc(r.x, r.y, r.r1 * (r.red ? 1 - k * 0.9 : k) + 2, 0, 7); c.stroke();
        }
        c.restore();
    }
    drawParts(c, ts) {
        const u = this.u;
        c.save(); c.globalCompositeOperation = 'lighter'; c.lineCap = 'round';
        for (const p of this.parts) {
            const K = KIND[p.kind];
            let al = p.amb ? Math.sin(Math.PI * Math.max(0, Math.min(1, 1 - p.life))) * 0.55 : Math.min(1, p.life * 2);
            al *= K.alpha || 1;
            if (al < 0.02) continue;
            const ci = mod(p.ci), sz = p.size * u, col = this.rgbs[ci];
            c.globalAlpha = al;
            switch (p.kind) {
                case 'spark':
                    c.strokeStyle = col; c.lineWidth = Math.max(1, sz * 0.8);
                    c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - p.vx * 0.04, p.y - p.vy * 0.04); c.stroke();
                    c.drawImage(this.sprites[ci], p.x - sz * 2, p.y - sz * 2, sz * 4, sz * 4); break;
                case 'ember':
                    { const f = sz * (2.2 + 0.6 * Math.sin(ts / 60 + p.seed * 20)); c.drawImage(this.sprites[ci], p.x - f, p.y - f, f * 2, f * 2); } break;
                case 'mist':
                    { const f = sz * (1 + (1 - p.life) * K.grow); c.drawImage(this.sprites[ci], p.x - f, p.y - f, f * 2, f * 2); } break;
                case 'star':
                    { const f = sz * (1.4 + 0.5 * Math.sin(ts / 90 + p.seed * 30)), g = f * 0.28;
                        c.fillStyle = col; c.beginPath(); c.moveTo(p.x, p.y - f); c.lineTo(p.x + g, p.y - g); c.lineTo(p.x + f, p.y); c.lineTo(p.x + g, p.y + g);
                        c.lineTo(p.x, p.y + f); c.lineTo(p.x - g, p.y + g); c.lineTo(p.x - f, p.y); c.lineTo(p.x - g, p.y - g); c.closePath(); c.fill(); } break;
                case 'snow':
                    c.strokeStyle = col; c.lineWidth = 1;
                    c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
                    c.beginPath(); for (let k = 0; k < 3; k++) { const an = (k * Math.PI) / 3; c.moveTo(Math.cos(an) * sz * 1.5, Math.sin(an) * sz * 1.5); c.lineTo(-Math.cos(an) * sz * 1.5, -Math.sin(an) * sz * 1.5); }
                    c.stroke(); c.restore(); break;
                case 'leaf':
                    c.fillStyle = col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
                    c.beginPath(); c.ellipse(0, 0, sz * 1.4, sz * 0.6, 0, 0, 7); c.fill(); c.restore(); break;
                case 'rune':
                    c.strokeStyle = col; c.lineWidth = 1.1; c.save(); c.translate(p.x, p.y); c.rotate(p.rot); c.beginPath();
                    if (p.seed < 0.33) { c.moveTo(0, -sz * 1.3); c.lineTo(sz * 1.2, sz); c.lineTo(-sz * 1.2, sz); c.closePath(); }
                    else if (p.seed < 0.66) { c.moveTo(-sz, 0); c.lineTo(sz, 0); c.moveTo(0, -sz); c.lineTo(0, sz); }
                    else { c.moveTo(0, -sz * 1.3); c.lineTo(sz * 0.9, 0); c.lineTo(0, sz * 1.3); c.lineTo(-sz * 0.9, 0); c.closePath(); }
                    c.stroke(); c.restore(); break;
                case 'bubble':
                    c.strokeStyle = col; c.lineWidth = 1; c.beginPath(); c.arc(p.x, p.y, sz, 0, 7); c.stroke();
                    c.globalAlpha = al * 0.7; c.fillStyle = '#fff'; c.fillRect(p.x - sz * 0.4, p.y - sz * 0.5, 1.5, 1.5); break;
                case 'shard':
                    c.fillStyle = col; c.save(); c.translate(p.x, p.y); c.rotate(p.rot);
                    c.beginPath(); c.moveTo(0, -sz * 1.4); c.lineTo(sz, sz * 0.8); c.lineTo(-sz, sz * 0.8); c.closePath(); c.fill(); c.restore(); break;
                default: break;
            }
        }
        c.restore();
    }
    /** Поверх всего (без дрожания): вспышка символа и красная рамка при нехватке времени. */
    drawOverlay(c, ts) {
        if (this.fxL < 2) return;
        c.save(); c.globalCompositeOperation = 'lighter';
        if (this.sflash) {
            const k = 1 - (performance.now() - this.sflash.t0) / this.sflash.dur;
            if (k > 0) { c.globalAlpha = this.sflash.a * k * k; c.fillStyle = this.sflash.red ? C.red : this.rgbs[mod(this.sflash.ci)]; c.fillRect(0, 0, this.w, this.h); }
        }
        const lim = this.session.params.time_limit;
        if (lim > 0 && this.started && !this.finished && this.timeLeft > 0 && this.timeLeft <= 5) {
            const pulse = 0.5 + 0.5 * Math.sin(ts / 160), g = c.createRadialGradient(this.w / 2, this.h / 2, this.bs * 0.35, this.w / 2, this.h / 2, Math.hypot(this.w, this.h) / 2);
            g.addColorStop(0, 'rgba(255,60,90,0)'); g.addColorStop(1, `rgba(255,60,90,${0.28 * pulse})`);
            c.globalAlpha = 1; c.fillStyle = g; c.fillRect(0, 0, this.w, this.h);
        }
        c.restore();
    }
}
