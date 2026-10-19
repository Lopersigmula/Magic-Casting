// Распознавание траекторий: ресемплинг по длине дуги + упорядоченное сравнение точек.
// Чистый модуль без зависимостей — можно тестировать в Node.
const N = 48;
const K_ROT = 24;

export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function pathLength(p) {
    let l = 0;
    for (let i = 1; i < p.length; i++) l += dist(p[i - 1], p[i]);
    return l;
}

export function cumLengths(p) {
    const c = [0];
    for (let i = 1; i < p.length; i++) c.push(c[i - 1] + dist(p[i - 1], p[i]));
    return c;
}

export function pointAt(p, cum, f) {
    const L = cum[cum.length - 1];
    const target = Math.max(0, Math.min(1, f)) * L;
    let j = 0;
    while (j < p.length - 2 && cum[j + 1] < target) j++;
    const seg = cum[j + 1] - cum[j];
    const t = seg > 0 ? (target - cum[j]) / seg : 0;
    return [p[j][0] + (p[j + 1][0] - p[j][0]) * t, p[j][1] + (p[j + 1][1] - p[j][1]) * t];
}

export function resample(p, n = N) {
    if (p.length < 2) return Array.from({ length: n }, () => p[0] || [0, 0]);
    const cum = cumLengths(p);
    const L = cum[cum.length - 1];
    if (L === 0) return Array.from({ length: n }, () => p[0]);
    const out = [];
    for (let k = 0; k < n; k++) out.push(pointAt(p, cum, k / (n - 1)));
    return out;
}

/** Готовит эталонный штрих: для замкнутых — варианты с разной стартовой точкой. */
export function prepareStroke(stroke) {
    let pts = stroke.pts.map(p => [p[0], p[1]]);
    const closed = !!stroke.closed;
    if (closed && dist(pts[0], pts[pts.length - 1]) > 1e-6) pts.push(pts[0].slice());
    const cum = cumLengths(pts);
    const length = cum[cum.length - 1];
    const flex = closed && stroke.flex !== false;
    let variants;
    if (flex) {
        variants = [];
        for (let k = 0; k < K_ROT; k++) {
            const s = (k / K_ROT) * length;
            let j = 0;
            while (j < pts.length - 2 && cum[j + 1] < s) j++;
            const seg = cum[j + 1] - cum[j];
            const t = seg > 0 ? (s - cum[j]) / seg : 0;
            const q = [pts[j][0] + (pts[j + 1][0] - pts[j][0]) * t, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * t];
            const arr = [q];
            for (let i = j + 1; i < pts.length; i++) arr.push(pts[i]);
            for (let i = 1; i <= j; i++) arr.push(pts[i]);
            arr.push(q);
            variants.push(resample(arr));
        }
    } else variants = [resample(pts)];
    return { pts, cum, length, closed, flex, variants, start: pts[0], end: pts[pts.length - 1] };
}

function score(u, variants) {
    let best = null;
    for (const r of variants) {
        const d = new Array(u.length);
        let sum = 0;
        for (let i = 0; i < u.length; i++) { d[i] = dist(u[i], r[i]); sum += d[i]; }
        const mean = sum / u.length;
        const sorted = d.slice().sort((a, b) => a - b);
        const p90 = sorted[Math.floor(sorted.length * 0.9)];
        const M = 0.65 * mean + 0.35 * (p90 / 2);
        if (!best || M < best.M) best = { M, mean, p90 };
    }
    return best;
}

/**
 * @param user  массив [x,y] в координатах рамки символа (0..1)
 * @param prep  результат prepareStroke
 * @param opt   { tol, strictness, tolMul }
 * @returns { ok, accuracy, reason }  reason: ok|early|late|reversed|bad_start|inaccurate
 */
export function evaluateStroke(user, prep, opt) {
    const tolEff = (opt.tol * 0.45 * (opt.tolMul || 1)) / (opt.strictness || 1);
    const L = pathLength(user);
    const ratio = L / prep.length;
    const u = resample(user);
    const fwd = score(u, prep.variants);
    const accuracy = Math.max(0, Math.min(1, 1 - fwd.M / (tolEff * 1.4)));
    const res = { ok: false, accuracy, reason: 'inaccurate', M: fwd.M, tolEff, ratio };

    if (ratio < 0.6) { res.reason = 'early'; return res; }
    if (ratio > 1.8) { res.reason = 'late'; return res; }
    if (fwd.M > tolEff) {
        const rev = score(u.slice().reverse(), prep.variants);
        res.reason = rev.M < fwd.M * 0.6 && rev.M <= tolEff * 1.3 ? 'reversed' : 'inaccurate';
        return res;
    }
    if (!prep.flex && dist(user[0], prep.start) > tolEff * 1.8) { res.reason = 'bad_start'; return res; }
    res.ok = true; res.reason = 'ok';
    return res;
}

export const REASON_TEXT = {
    ok: 'Чисто!',
    early: 'Линия оборвана слишком рано — дорисуйте символ до конца.',
    late: 'Слишком длинная линия — остановитесь в конце символа.',
    reversed: 'Неверное направление — следуйте стрелке.',
    bad_start: 'Начните с отмеченной точки.',
    inaccurate: 'Линия слишком далеко от контура.',
};
