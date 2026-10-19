// Звуковой движок Magic Casting: всё синтезируется через WebAudio (без файлов).
// Тембр и тональность зависят от стихии ауры; звук рисования следует за скоростью пальца.

const TIMBRES = {
    fire: { w: 'triangle', root: 174.6, sc: 'min' }, ice: { w: 'sine', root: 392, sc: 'maj' },
    water: { w: 'sine', root: 261.6, sc: 'maj' }, lightning: { w: 'square', root: 293.7, sc: 'min' },
    earth: { w: 'triangle', root: 130.8, sc: 'min' }, wind: { w: 'sine', root: 329.6, sc: 'maj' },
    light: { w: 'sine', root: 440, sc: 'maj' }, dark: { w: 'triangle', root: 110, sc: 'min' },
    nature: { w: 'sine', root: 293.7, sc: 'maj' }, blood: { w: 'sawtooth', root: 146.8, sc: 'min' },
    arcane: { w: 'sine', root: 349.2, sc: 'min' },
};
const SCALES = { min: [0, 3, 5, 7, 10], maj: [0, 2, 4, 7, 9] };
let T = TIMBRES.arcane;
const note = (i, oct = 0) => {
    const sc = SCALES[T.sc], n = Math.floor(i / 5), k = ((i % 5) + 5) % 5;
    return T.root * Math.pow(2, (sc[k] + 12 * n) / 12) * Math.pow(2, oct);
};

let ac = null, master = null, dry = null, verbSend = null, noiseBuf = null;
let enabled = true, volume = 0.7, pad = null, dr = null;

const mv = () => 0.9 * volume * volume;

function makeIR(a, sec, decay) {
    const len = Math.floor(a.sampleRate * sec), b = a.createBuffer(2, len, a.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
        const d = b.getChannelData(ch);
        for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
}
function makeNoise(a, sec) {
    const len = Math.floor(a.sampleRate * sec), b = a.createBuffer(1, len, a.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
}

/** Лениво создаёт AudioContext (после жеста пользователя). Возвращает null, если звук выключен. */
function ctx() {
    if (!enabled) return null;
    try {
        if (!ac) {
            const AC = window.AudioContext || window.webkitAudioContext;
            if (!AC) return null;
            ac = new AC();
            master = ac.createGain(); master.gain.value = mv();
            const comp = ac.createDynamicsCompressor();
            comp.threshold.value = -16; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.2;
            master.connect(comp); comp.connect(ac.destination);
            dry = ac.createGain(); dry.connect(master);
            verbSend = ac.createGain();
            const verb = ac.createConvolver(); verb.buffer = makeIR(ac, 2.0, 2.6);
            verbSend.connect(verb); verb.connect(master);
            noiseBuf = makeNoise(ac, 2);
        }
        if (ac.state === 'suspended') ac.resume();
        return ac;
    } catch { return null; }
}

/** Подключает узел к «сухому» выходу и (с долей wet) к реверберации. */
function out(node, wet = 0.3) {
    node.connect(dry);
    if (wet > 0) { const w = ac.createGain(); w.gain.value = wet; node.connect(w); w.connect(verbSend); }
}

function tone({ f, t = 0, dur = 0.3, type, vol = 0.08, att = 0.006, slide = 1, wet = 0.35, det = 0 }) {
    const a = ctx(); if (!a) return;
    type = type || T.w;
    const t0 = a.currentTime + t, osc = a.createOscillator(), g = a.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t0);
    if (slide !== 1) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f * slide), t0 + dur);
    osc.detune.value = det;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    if (type === 'square' || type === 'sawtooth') {
        const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400;
        g.connect(lp); out(lp, wet);
    } else out(g, wet);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
}

function noise({ t = 0, dur = 0.3, vol = 0.08, type = 'bandpass', f = 1000, fEnd, q = 1, att = 0.005, wet = 0.25 }) {
    const a = ctx(); if (!a) return;
    const t0 = a.currentTime + t, src = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
    src.buffer = noiseBuf; src.loop = true;
    fl.type = type; fl.frequency.setValueAtTime(f, t0); fl.Q.value = q;
    if (fEnd) fl.frequency.exponentialRampToValueAtTime(Math.max(20, fEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + att);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(fl); fl.connect(g); out(g, wet);
    src.start(t0, Math.random() * 1.5); src.stop(t0 + dur + 0.05);
}

/* ---------- настройка ---------- */
export function configure(on, vol) {
    enabled = !!on;
    volume = Math.max(0, Math.min(1, typeof vol === 'number' ? vol : 0.7));
    if (master) master.gain.value = mv();
    if (!enabled) { drawStop(); stopCast(true); }
}
/** Вызывать синхронно из обработчика клика — на iOS звук разрешается только жестом. */
export function unlock() {
    const a = ctx(); if (!a) return;
    try { const s = a.createBufferSource(); s.buffer = a.createBuffer(1, 1, 22050); s.connect(a.destination); s.start(0); } catch { /* ok */ }
}

/* ---------- фон заклинания (пад) ---------- */
export function startCast(aura) {
    stopCast(true);
    T = TIMBRES[aura && aura.element] || TIMBRES.arcane;
    const a = ctx(); if (!a) return;
    const g = a.createGain(); g.gain.value = 0.0001;
    const lp = a.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500; lp.Q.value = 2;
    const o1 = a.createOscillator(), o2 = a.createOscillator(), o3 = a.createOscillator(), lfo = a.createOscillator();
    o1.type = 'triangle'; o1.frequency.value = T.root / 2;
    o2.type = 'sine'; o2.frequency.value = T.root * 0.75; o2.detune.value = 7;
    o3.type = 'sine'; o3.frequency.value = T.root / 4;
    lfo.frequency.value = 0.25;
    const lg = a.createGain(); lg.gain.value = 250; lfo.connect(lg); lg.connect(lp.frequency);
    o1.connect(lp); o2.connect(lp); o3.connect(lp); lp.connect(g); out(g, 0.5);
    g.gain.setTargetAtTime(0.04, a.currentTime, 0.4);
    [o1, o2, o3, lfo].forEach(o => o.start());
    pad = { g, lp, nodes: [o1, o2, o3, lfo] };
}
export function setIntensity(x) {
    if (!pad || !ac) return;
    const t = ac.currentTime;
    pad.g.gain.setTargetAtTime(0.035 + 0.05 * x, t, 0.2);
    pad.lp.frequency.setTargetAtTime(450 + 1400 * x, t, 0.2);
}
export function stopCast(quick) {
    if (!pad || !ac) { pad = null; return; }
    const p = pad; pad = null; const t = ac.currentTime;
    p.g.gain.cancelScheduledValues(t);
    p.g.gain.setTargetAtTime(0.0001, t, quick ? 0.05 : 0.15);
    p.nodes.forEach(n => { try { n.stop(t + (quick ? 0.3 : 0.9)); } catch { /* ok */ } });
}

/* ---------- звук линии под пальцем ---------- */
export function drawStart() {
    drawStop();
    const a = ctx(); if (!a) return;
    const src = a.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.2;
    const ng = a.createGain(); ng.gain.value = 0;
    src.connect(bp); bp.connect(ng);
    const osc = a.createOscillator(); osc.type = 'sine'; osc.frequency.value = note(0, 1);
    const lfo = a.createOscillator(); lfo.frequency.value = 21;
    const lg = a.createGain(); lg.gain.value = 0; lfo.connect(lg); lg.connect(osc.detune);
    const og = a.createGain(); og.gain.value = 0; osc.connect(og);
    out(ng, 0.25); out(og, 0.45);
    src.start(); osc.start(); lfo.start();
    dr = { src, bp, ng, osc, lfo, lg, og };
}
/** speed — доли поля в секунду; prog — прогресс штриха 0..1; shiver — нарастающая дрожь 0..1 */
export function drawMove(speed, prog, shiver) {
    if (!dr || !ac) return;
    const t = ac.currentTime, v = Math.min(1, speed / 1.6);
    dr.ng.gain.setTargetAtTime(0.012 + 0.10 * v, t, 0.06);
    dr.bp.frequency.setTargetAtTime(500 + 2200 * v, t, 0.06);
    dr.og.gain.setTargetAtTime(speed > 0.04 ? 0.025 + 0.03 * v : 0, t, 0.08);
    dr.osc.frequency.setTargetAtTime(note(Math.floor(Math.max(0, Math.min(1, prog)) * 7), 1), t, 0.05);
    dr.lg.gain.setTargetAtTime(shiver * 60, t, 0.05);
}
export function drawStop() {
    if (!dr || !ac) { dr = null; return; }
    const d = dr; dr = null; const t = ac.currentTime;
    d.ng.gain.setTargetAtTime(0, t, 0.04); d.og.gain.setTargetAtTime(0, t, 0.04);
    [d.src, d.osc, d.lfo].forEach(n => { try { n.stop(t + 0.25); } catch { /* ok */ } });
}

/* ---------- события ---------- */
export function stroke(acc = 0.8) {
    const k = 0.5 + 0.5 * acc;
    tone({ f: note(5, 1), dur: 0.35, vol: 0.07 * k });
    tone({ f: note(7, 1), t: 0.07, dur: 0.4, vol: 0.06 * k });
    noise({ type: 'highpass', f: 5000, dur: 0.12, vol: 0.025, wet: 0.3 });
}
export function symbol(i = 0, final = false) {
    const base = 2 + (i % 3);
    [0, 2, 4, 7].forEach((d, j) => tone({ f: note(base + d, 1), t: j * 0.07, dur: 0.5, vol: 0.07, wet: 0.5 }));
    tone({ f: note(base + 9, 2), t: 0.3, dur: 0.9, vol: 0.04, type: 'sine', wet: 0.7 });
    tone({ f: 62, dur: 0.45, vol: 0.16, slide: 0.5, type: 'sine', wet: 0.1 });
    noise({ type: 'bandpass', f: 400, fEnd: 5000, dur: 0.45, vol: 0.05, q: 0.8 });
    if (final) [0, 4, 7, 9].forEach((d, j) => tone({ f: note(d + 5, 2), t: 0.35 + j * 0.06, dur: 1.0, vol: 0.035, type: 'sine', wet: 0.8 }));
}
/** Лёгкая дрожь в конце символа: низкий гул, затухающий вместе с визуальным дрожанием. */
export function tremble(sec = 0.8) {
    noise({ type: 'lowpass', f: 140, dur: sec, vol: 0.14, att: 0.02, wet: 0.1 });
    tone({ f: 55, dur: sec, vol: 0.07, type: 'triangle', slide: 0.9, wet: 0.1 });
    tone({ f: note(9, 1), dur: sec, vol: 0.02, type: 'sine', det: 30, wet: 0.5 });
}
export function error() {
    tone({ f: 170, dur: 0.22, type: 'sawtooth', vol: 0.05, slide: 0.6, wet: 0.1 });
    noise({ type: 'bandpass', f: 900, fEnd: 300, dur: 0.18, vol: 0.05 });
}
/** Заклинание срывается: схлопывающийся шум и нисходящие тона. */
export function fail() {
    noise({ type: 'lowpass', f: 3000, fEnd: 80, dur: 0.6, vol: 0.12 });
    [4, 2, 0].forEach((d, j) => tone({ f: note(d, 0), t: j * 0.1, dur: 0.4, vol: 0.06, type: 'triangle', slide: 0.8, wet: 0.4 }));
}
export function tick() { tone({ f: 1500, dur: 0.06, type: 'square', vol: 0.03, wet: 0.05 }); }
export function win() {
    [0, 2, 4, 7, 9].forEach((d, j) => tone({ f: note(d, 1), t: j * 0.08, dur: 1.4, vol: 0.07, wet: 0.6 }));
    noise({ type: 'highpass', f: 3000, dur: 0.9, vol: 0.03, att: 0.2, wet: 0.7 });
}
export function lose() {
    [330, 247, 185].forEach((f, i) => tone({ f, t: i * 0.12, dur: 0.3, type: 'triangle', vol: 0.05, wet: 0.2 }));
}

/** Совместимость со старым API. */
export function play(kind, on = true) {
    if (!on) return;
    if (kind === 'ok') stroke(0.8);
    else if (kind === 'bad') error();
    else if (kind === 'win') win();
    else if (kind === 'lose') lose();
}
