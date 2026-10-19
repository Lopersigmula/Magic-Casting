// Мини-игра: Canvas-отрисовка, ввод (touch/mouse/pen через Pointer Events) и ход заклинания.
import { evaluateStroke, pathLength, pointAt, dist, REASON_TEXT } from './recognizer.js';

const C = { cyan: '#5ee7ff', violet: '#a78bfa', teal: '#2dd4bf', red: '#ff5d73', dim: 'rgba(130,160,230,0.28)' };

export class Game {
    constructor(canvas, cb) {
        this.canvas = canvas; this.ctx = canvas.getContext('2d'); this.cb = cb;
        this.w = 0; this.h = 0; this.dpr = 1;
        this.session = null; this.running = false; this.paused = false; this.finished = true; this.lock = false;
        this.trail = []; this.drawing = false; this.pid = null; this.fx = []; this.flash = null;
        this.raf = 0; this.last = 0; this.tickAcc = 0; this.timeouts = new Set();

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
        this.render();
    }

    px(p) { return [this.bx + p[0] * this.bs, this.by + p[1] * this.bs]; }
    norm(e) {
        const r = this.canvas.getBoundingClientRect();
        return [(e.clientX - r.left - this.bx) / this.bs, (e.clientY - r.top - this.by) / this.bs];
    }
    later(fn, ms) { const t = setTimeout(() => { this.timeouts.delete(t); fn(); }, ms); this.timeouts.add(t); }

    /* ---------- управление ---------- */
    start(session) {
        this.clearTimers();
        this.session = session;
        const p = session.params;
        this.symIdx = 0; this.strokeIdx = 0; this.mistakes = 0; this.scores = []; this.strokeAcc = [];
        this.elapsed = 0; this.timeLeft = p.time_limit || 0; this.started = false; this.finished = false; this.lock = false;
        this.done = []; this.trail = []; this.fx = []; this.flash = null; this.appearT = 0; this.paused = false;
        this.resize();
        this.cb.onSymbol(this.info());
        this.loop(performance.now(), true);
    }
    restart() { if (this.session) this.start(this.session); }
    cancel() { if (!this.finished) this.finish('cancel', 'cancel'); }
    destroy() { this.clearTimers(); cancelAnimationFrame(this.raf); this.ro.disconnect(); }
    clearTimers() { this.timeouts.forEach(clearTimeout); this.timeouts.clear(); }
    setPaused(v) {
        this.paused = v;
        if (this.drawing) { this.drawing = false; this.trail = []; }
        if (!v && !this.finished) this.loop(performance.now(), true);
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
        this.trail = [this.norm(e)];
        try { this.canvas.setPointerCapture(e.pointerId); } catch { /* не критично */ }
        this.started = true;
    }
    move(e) {
        if (!this.drawing || e.pointerId !== this.pid) return;
        e.preventDefault();
        const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
        for (const ev of (evs.length ? evs : [e])) {
            const p = this.norm(ev), l = this.trail[this.trail.length - 1];
            if (dist(p, l) > 0.004) this.trail.push(p);
        }
    }
    up(e) {
        if (!this.drawing || e.pointerId !== this.pid) return;
        this.drawing = false;
        try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ok */ }
        this.finishStroke();
    }

    /* ---------- ход игры ---------- */
    finishStroke() {
        const trail = this.trail; this.trail = [];
        if (trail.length < 5 || pathLength(trail) < 0.05) return;   // случайное касание — не ошибка
        const sym = this.sym, stroke = sym.strokes[this.strokeIdx], p = this.session.params;
        const res = evaluateStroke(trail, stroke.prep, { tol: p.drawing_tolerance, strictness: this.session.opts.strictness, tolMul: sym.tolMul });
        if (res.ok) {
            this.strokeAcc.push(res.accuracy);
            this.done.push(trail);
            this.strokeIdx++;
            this.burst(this.px(stroke.prep.end), C.cyan, 10);
            this.cb.onFeedback({ ok: true, accuracy: res.accuracy, text: res.accuracy > 0.8 ? 'Отлично!' : 'Принято' });
            if (this.strokeIdx >= sym.strokes.length) {
                const acc = this.strokeAcc.reduce((a, b) => a + b, 0) / sym.strokes.length;
                this.scores.push(acc);
                this.cb.onSymbolDone({ index: this.symIdx, accuracy: acc });
                this.burst([this.w / 2, this.h / 2], C.violet, 26);
                this.lock = true;
                this.later(() => this.nextSymbol(), this.anim === 'off' ? 120 : 650);
            }
        } else {
            this.mistakes++;
            this.flash = { t: performance.now(), pts: trail };
            this.cb.onFeedback({ ok: false, accuracy: res.accuracy, text: REASON_TEXT[res.reason] || 'Ошибка' });
            if (this.mistakes > p.allowed_mistakes) this.finish('failed', 'mistakes');
            else this.cb.onSymbol(this.info());
        }
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
                if (this.timeLeft <= 0) { this.finish('failed', 'timeout'); return; }
            }
        }
        this.appearT = Math.min(1, this.appearT + dt * (this.anim === 'off' ? 20 : 2.5));
        this.tickAcc += dt;
        if (this.tickAcc > 0.1) {
            this.tickAcc = 0;
            const sym = this.sym, st = sym.strokes[this.strokeIdx];
            let live = 0;
            if (this.drawing && st) live = Math.min(1, pathLength(this.trail) / st.prep.length);
            this.cb.onTick({ timeLeft: this.timeLeft, elapsed: this.elapsed,
                progress: Math.min(1, (this.strokeIdx + live) / sym.strokes.length) });
        }
        this.render(ts);
        this.raf = requestAnimationFrame(t => this.loop(t));
    }

    burst(at, color, n) {
        if (this.anim !== 'full') return;
        for (let i = 0; i < n; i++) {
            const a = Math.random() * Math.PI * 2, v = 40 + Math.random() * 120;
            this.fx.push({ x: at[0], y: at[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, color });
        }
    }

    /* ---------- отрисовка ---------- */
    path(pts, prefix) {
        const c = this.ctx; c.beginPath();
        pts.forEach((p, i) => { const q = this.px(p); i ? c.lineTo(q[0], q[1]) : c.moveTo(q[0], q[1]); });
    }
    line(pts, color, width, glow, alpha = 1, dash) {
        const c = this.ctx;
        c.save(); c.globalAlpha = alpha; c.strokeStyle = color; c.lineWidth = width;
        c.lineCap = 'round'; c.lineJoin = 'round';
        if (dash) c.setLineDash(dash);
        if (glow && this.anim === 'full') { c.shadowColor = color; c.shadowBlur = glow; }
        this.path(pts); c.stroke(); c.restore();
    }

    render(ts = performance.now()) {
        const c = this.ctx;
        if (!this.w) return;
        c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        c.clearRect(0, 0, this.w, this.h);
        if (!this.session) return;

        // тонкая рамка поля символа
        c.save(); c.strokeStyle = 'rgba(120,150,255,0.18)'; c.lineWidth = 1;
        c.strokeRect(this.bx, this.by, this.bs, this.bs); c.restore();

        const sym = this.sym, lw = Math.max(3, this.bs * 0.016), a = this.appearT;
        sym.strokes.forEach((st, i) => {
            if (i < this.strokeIdx) this.line(st.prep.pts, C.teal, lw, 14, 0.9);
            else if (i === this.strokeIdx) this.line(st.prep.pts, C.cyan, lw, 10, 0.38 * a, [this.bs * 0.03, this.bs * 0.02]);
            else this.line(st.prep.pts, C.dim, lw * 0.8, 0, a, [this.bs * 0.02, this.bs * 0.03]);
        });

        const cur = sym.strokes[this.strokeIdx];
        if (cur && !this.finished) {
            const pp = cur.prep, s0 = this.px(pp.start);
            const pulse = this.anim === 'off' ? 1 : 1 + 0.25 * Math.sin(ts / 220);
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

        this.done.forEach(t => this.line(t, C.violet, lw * 0.7, 0, 0.35));
        if (this.trail.length > 1) this.line(this.trail, '#ffffff', lw * 1.1, 14);
        if (this.flash) {
            const k = 1 - (ts - this.flash.t) / 450;
            if (k > 0 && this.anim !== 'off') this.line(this.flash.pts, C.red, lw * 1.1, 10, k);
            else this.flash = null;
        }
        if (this.fx.length) {
            const dt = 1 / 60;
            this.fx = this.fx.filter(p => (p.life -= dt * 1.6) > 0);
            c.save();
            for (const p of this.fx) {
                p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96;
                c.globalAlpha = Math.max(0, p.life); c.fillStyle = p.color;
                c.fillRect(p.x - 2, p.y - 2, 4, 4);
            }
            c.restore();
        }
    }
}
