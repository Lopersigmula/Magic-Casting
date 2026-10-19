// Пресеты сложности, валидация ответа ИИ и подбор символов.
import { getLibrary, hasSymbol } from './symbols.js';

export const PRESETS = {
    1: { symbol_count: 1, time_limit: 40, allowed_mistakes: 5, drawing_tolerance: 0.26, trace_speed: 0.8 },
    2: { symbol_count: 2, time_limit: 32, allowed_mistakes: 4, drawing_tolerance: 0.22, trace_speed: 0.9 },
    3: { symbol_count: 3, time_limit: 30, allowed_mistakes: 3, drawing_tolerance: 0.20, trace_speed: 1.0 },
    4: { symbol_count: 3, time_limit: 22, allowed_mistakes: 2, drawing_tolerance: 0.16, trace_speed: 1.15 },
    5: { symbol_count: 4, time_limit: 18, allowed_mistakes: 1, drawing_tolerance: 0.12, trace_speed: 1.3 },
};
export const DIFF_NAMES = ['', 'Очень легко', 'Легко', 'Средне', 'Сложно', 'Экстремально'];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (+v && isFinite(+v) ? +v : d));
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function pickSymbols(level, count, preferred = []) {
    const out = preferred.filter(hasSymbol).slice(0, count);
    const lib = getLibrary();
    let pool = lib.filter(s => Math.abs(s.tier - level) <= 1);
    if (!pool.length) pool = lib;
    pool = shuffle(pool);
    let guard = 0;
    while (out.length < count && guard++ < 50) {
        const cand = pool[out.length % pool.length];
        if (out[out.length - 1] !== cand.id || pool.length === 1) out.push(cand.id);
        else pool.push(pool.shift());
    }
    return out;
}

/** Собирает итоговые параметры из «сырого» ответа ИИ (или без него). Все значения ограничиваются. */
export function buildParams(raw, s, { level, name, source }) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const maxLvl = clamp(Math.round(s.maxDifficulty), 1, 5);
    const lvl = clamp(Math.round(num(level ?? raw.difficulty, s.defaultDifficulty)), 1, maxLvl);
    const p = PRESETS[lvl];
    const count = clamp(Math.round(num(raw.symbol_count, p.symbol_count)), 1, 6);
    const prefList = Array.isArray(raw.symbols) ? raw.symbols.filter(x => typeof x === 'string').slice(0, 6) : [];
    const symbols = pickSymbols(lvl, prefList.length ? clamp(prefList.filter(hasSymbol).length || count, 1, 6) : count, prefList);
    const fixed = source === 'manual' || source === 'default';   // при ручной сложности берём чистый пресет
    const r = fixed ? {} : raw;

    let time = num(r.time_limit, p.time_limit * symbols.length / p.symbol_count);
    time = s.timerEnabled ? clamp(Math.round(time), s.minTime, Math.max(s.minTime, s.maxTime)) : 0;
    const mistakes = clamp(Math.round(num(r.allowed_mistakes, p.allowed_mistakes)) + Math.round(s.extraMistakes), 0, 10);
    return {
        spell_name: String(raw.spell_name || name || 'Заклинание').slice(0, 60),
        difficulty: lvl,
        symbols,
        symbol_count: symbols.length,
        time_limit: time,
        allowed_mistakes: mistakes,
        drawing_tolerance: clamp(num(r.drawing_tolerance, p.drawing_tolerance), 0.08, 0.35),
        trace_speed: clamp(num(r.trace_speed, p.trace_speed), 0.5, 2),
        complexity_reason: String(raw.complexity_reason || '').slice(0, 200),
        source,
    };
}
