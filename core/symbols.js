// Библиотека заранее подготовленных символов. Координаты нормализованы (0..1, y вниз).
// ИИ может выбирать только id из этой библиотеки.
import { prepareStroke } from './recognizer.js';

const RAD = Math.PI / 180;
const arc = (cx, cy, r, a0, a1, n = 40) =>
    Array.from({ length: n + 1 }, (_, i) => { const a = (a0 + (a1 - a0) * i / n) * RAD; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });

function fit(pts, m = 0.08) {
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const k = (1 - 2 * m) / Math.max(x1 - x0, y1 - y0);
    const ox = 0.5 - ((x0 + x1) / 2) * k, oy = 0.5 - ((y0 + y1) / 2) * k;
    return pts.map(p => [p[0] * k + ox, p[1] * k + oy]);
}
const star = (n, skip, r = 0.43) => Array.from({ length: n + 1 }, (_, k) => {
    const a = (-90 + ((k * skip) % n) * 360 / n) * RAD; return [0.5 + r * Math.cos(a), 0.52 + r * Math.sin(a)];
});
const S = (pts, closed = false) => ({ pts, closed });
const param = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(i / n));

const spiral = param(90, t => { const a = (270 + t * 630) * RAD, r = 0.43 * (1 - 0.88 * t); return [0.5 + r * Math.cos(a), 0.5 + r * Math.sin(a)]; });
const infinity = fit(param(80, t => { const a = t * 2 * Math.PI, d = 1 + Math.sin(a) ** 2; return [Math.cos(a) / d, Math.sin(a) * Math.cos(a) / d]; }), 0.07);
const heart = fit(param(80, t => { const a = t * 2 * Math.PI; return [16 * Math.sin(a) ** 3, -(13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a))]; }), 0.08);
const lens = [...param(30, t => [0.1 + 0.8 * t, 0.5 - 0.3 * Math.sin(Math.PI * t)]), ...param(30, t => [0.9 - 0.8 * t, 0.5 + 0.3 * Math.sin(Math.PI * t)])];
const wave = param(60, t => [0.08 + 0.84 * t, 0.5 - 0.22 * Math.sin(t * 4 * Math.PI)]);

const BUILTIN = [
    { id: 'line_v', name: 'Вертикаль', tier: 1, strokes: [S([[0.5, 0.1], [0.5, 0.9]])] },
    { id: 'line_h', name: 'Горизонталь', tier: 1, strokes: [S([[0.1, 0.5], [0.9, 0.5]])] },
    { id: 'diagonal', name: 'Диагональ', tier: 1, strokes: [S([[0.12, 0.88], [0.88, 0.12]])] },
    { id: 'chevron', name: 'Шеврон', tier: 1, strokes: [S([[0.12, 0.75], [0.5, 0.2], [0.88, 0.75]])] },
    { id: 'arc_dome', name: 'Купол', tier: 1, strokes: [S(arc(0.5, 0.62, 0.38, 180, 360))] },
    { id: 'circle', name: 'Круг', tier: 1, strokes: [S(arc(0.5, 0.5, 0.4, 270, 630, 60), true)] },
    { id: 'triangle', name: 'Треугольник', tier: 2, strokes: [S([[0.5, 0.12], [0.88, 0.82], [0.12, 0.82], [0.5, 0.12]], true)] },
    { id: 'square', name: 'Квадрат', tier: 2, strokes: [S([[0.15, 0.15], [0.85, 0.15], [0.85, 0.85], [0.15, 0.85], [0.15, 0.15]], true)] },
    { id: 'diamond', name: 'Ромб', tier: 2, strokes: [S([[0.5, 0.08], [0.88, 0.5], [0.5, 0.92], [0.12, 0.5], [0.5, 0.08]], true)] },
    { id: 'zigzag', name: 'Зигзаг', tier: 2, strokes: [S([[0.1, 0.8], [0.3, 0.2], [0.5, 0.8], [0.7, 0.2], [0.9, 0.8]])] },
    { id: 'wave', name: 'Волна', tier: 2, strokes: [S(wave)] },
    { id: 'arrow_up', name: 'Стрела', tier: 2, strokes: [S([[0.5, 0.92], [0.5, 0.1]]), S([[0.2, 0.4], [0.5, 0.1], [0.8, 0.4]])] },
    { id: 'hourglass', name: 'Песочные часы', tier: 3, strokes: [S([[0.2, 0.12], [0.8, 0.12], [0.2, 0.88], [0.8, 0.88], [0.2, 0.12]], true)] },
    { id: 'crescent', name: 'Полумесяц', tier: 3, strokes: [S([...arc(0.55, 0.5, 0.38, 300, 60, 40), ...arc(0.593, 0.5, 0.36, 66, 294, 40)], true)] },
    { id: 'star4', name: 'Четырёхлучевая звезда', tier: 3, strokes: [S([[0.5, 0.06], [0.62, 0.38], [0.94, 0.5], [0.62, 0.62], [0.5, 0.94], [0.38, 0.62], [0.06, 0.5], [0.38, 0.38], [0.5, 0.06]], true)] },
    { id: 'spiral', name: 'Спираль', tier: 3, strokes: [S(spiral)] },
    { id: 'lightning', name: 'Молния', tier: 3, strokes: [S([[0.62, 0.06], [0.3, 0.5], [0.7, 0.5], [0.38, 0.94]])] },
    { id: 'lens', name: 'Врата (линза)', tier: 3, strokes: [S(lens, true)] },
    { id: 'circle_cross', name: 'Солнечный крест', tier: 3, strokes: [S(arc(0.5, 0.5, 0.4, 270, 630, 60), true), S([[0.5, 0.1], [0.5, 0.9]]), S([[0.1, 0.5], [0.9, 0.5]])] },
    { id: 'rune_fehu', name: 'Руна Феху', tier: 3, strokes: [S([[0.3, 0.08], [0.3, 0.92]]), S([[0.3, 0.38], [0.76, 0.12]]), S([[0.3, 0.66], [0.76, 0.4]])] },
    { id: 'rune_algiz', name: 'Руна Альгиз', tier: 3, strokes: [S([[0.5, 0.92], [0.5, 0.08]]), S([[0.18, 0.18], [0.5, 0.52], [0.82, 0.18]])] },
    { id: 'heart', name: 'Сердце', tier: 4, strokes: [S(heart, true)] },
    { id: 'infinity', name: 'Бесконечность', tier: 4, strokes: [S(infinity, true)] },
    { id: 'star5', name: 'Пентаграмма', tier: 4, strokes: [S(star(5, 2), true)] },
    { id: 'trident', name: 'Трезубец', tier: 4, strokes: [S(arc(0.5, 0.45, 0.32, 180, 0, 40)), S([[0.5, 0.95], [0.5, 0.08]])] },
    { id: 'eye', name: 'Всевидящее око', tier: 4, strokes: [S(lens, true), S(arc(0.5, 0.5, 0.11, 270, 630, 24), true)] },
    { id: 'hexagram', name: 'Гексаграмма', tier: 5, strokes: [S(star(3, 1, 0.45).map(p => [p[0], p[1] - 0.02]), true), S(star(3, 1, 0.45).map(p => [p[0], 1.04 - p[1]]), true)] },
    { id: 'star7', name: 'Септаграмма', tier: 5, strokes: [S(star(7, 3), true)] },
];

const lib = new Map();

function clamp01(v) { return Math.max(0, Math.min(1, +v || 0)); }

/** Регистрирует символ (встроенный или из файла данных) с валидацией. */
export function registerSymbol(def) {
    if (!def || typeof def.id !== 'string' || !/^[a-z0-9_\-]{1,40}$/i.test(def.id) || lib.has(def.id)) return false;
    if (!Array.isArray(def.strokes) || !def.strokes.length || def.strokes.length > 6) return false;
    const strokes = [];
    for (const raw of def.strokes) {
        const pts = Array.isArray(raw) ? raw : raw && raw.pts;
        if (!Array.isArray(pts) || pts.length < 2 || pts.length > 400) return false;
        const clean = pts.map(p => [clamp01(p[0]), clamp01(p[1])]);
        const st = { pts: clean, closed: !Array.isArray(raw) && !!raw.closed };
        st.prep = prepareStroke(st);
        if (st.prep.length < 0.1) return false;
        strokes.push(st);
    }
    lib.set(def.id, {
        id: def.id, name: String(def.name || def.id).slice(0, 40),
        tier: Math.max(1, Math.min(5, Math.round(def.tier) || 2)),
        tolMul: Math.max(0.5, Math.min(2, +def.tolMul || 1)),
        strokes,
    });
    return true;
}

BUILTIN.forEach(registerSymbol);

export const getLibrary = () => [...lib.values()];
export const getSymbol = id => lib.get(id);
export const hasSymbol = id => lib.has(id);

/** Подгружает дополнительные символы из data/user-symbols.json (необязательно). */
export async function loadExtraSymbols(url) {
    try {
        const r = await fetch(url, { cache: 'no-cache' });
        if (!r.ok) return 0;
        const list = await r.json();
        let n = 0;
        for (const d of Array.isArray(list) ? list : []) if (registerSymbol(d)) n++;
        return n;
    } catch (e) { return 0; }
}
