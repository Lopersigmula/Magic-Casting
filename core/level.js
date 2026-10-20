// Система уровней: опыт копится отдельно для каждого чата и облегчает кастование.
// Данные хранятся в метаданных чата (chatMetadata) — они переезжают вместе с файлом чата.
// Запасной вариант (если метаданных нет) — карта в настройках расширения по id чата.
import { getContext, MODULE } from './st.js';
import { getSettings, saveSettings } from './settings.js';

export const MAX_LEVEL = 20;
const BASE_XP = [0, 10, 18, 30, 45, 65];     // опыт за идеальное заклинание сложности 1–5
const FAIL_MUL = 0.3;                        // за провал — только часть опыта (учимся на ошибках)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export const RANKS = [
    [1, 'Ученик'], [4, 'Адепт'], [8, 'Маг'], [13, 'Мастер'], [18, 'Архимаг'],
];
export const rankOf = lvl => RANKS.reduce((r, [from, name]) => (lvl >= from ? name : r), RANKS[0][1]);

/** Опыт, нужный для перехода с уровня L на L+1. */
export const xpToNext = L => Math.round(40 * Math.pow(L, 1.25));
/** Суммарный опыт, с которого начинается уровень L. */
export function xpAtLevel(L) { let t = 0; for (let i = 1; i < L; i++) t += xpToNext(i); return t; }
export function levelFromXp(xp) {
    let L = 1, left = Math.max(0, xp);
    while (L < MAX_LEVEL && left >= xpToNext(L)) { left -= xpToNext(L); L++; }
    return L;
}

/* ---------- хранилище (по чатам) ---------- */
function chatId(ctx) {
    return ctx.chatId !== undefined && ctx.chatId !== null && ctx.chatId !== '' ? String(ctx.chatId) : null;
}

/** @returns {{xp:number}|null} null — чат не открыт. */
function readSlot() {
    const ctx = getContext(), id = chatId(ctx);
    if (!id) return null;
    const meta = ctx.chatMetadata;
    let d;
    if (meta && typeof meta === 'object') d = meta[MODULE];
    else d = getSettings().levelsByChat[(ctx.groupId || ctx.characterId) + ':' + id];
    return { xp: d && isFinite(d.xp) ? Math.max(0, d.xp) : 0 };
}

function writeSlot(data) {
    const ctx = getContext(), id = chatId(ctx);
    if (!id) return;
    const meta = ctx.chatMetadata;
    if (meta && typeof meta === 'object') {
        meta[MODULE] = { xp: data.xp };
        try { (ctx.saveMetadataDebounced || ctx.saveMetadata)?.call(ctx); }
        catch (e) { console.warn('[Magic Casting] не удалось сохранить уровень в чате', e); }
    } else {
        getSettings().levelsByChat[(ctx.groupId || ctx.characterId) + ':' + id] = { xp: data.xp };
        saveSettings();
    }
}

/* ---------- состояние ---------- */
export const levelEnabled = () => !!getSettings().levelEnabled;

/** Текущее состояние уровня активного чата (для интерфейса и расчётов). */
export function getLevelState() {
    const slot = readSlot();
    const xp = slot ? slot.xp : 0;
    const level = levelFromXp(xp);
    const base = xpAtLevel(level), need = level >= MAX_LEVEL ? 0 : xpToNext(level);
    return { hasChat: !!slot, xp, level, rank: rankOf(level), inLevel: xp - base, need,
        progress: need ? clamp((xp - base) / need, 0, 1) : 1, max: level >= MAX_LEVEL };
}

export function resetLevel() { writeSlot({ xp: 0 }); }
/** Ставит уровень вручную (опыт внутри уровня обнуляется). Возвращает false, если чат не открыт. */
export function setLevel(L) {
    if (!readSlot()) return false;
    writeSlot({ xp: xpAtLevel(clamp(Math.round(L) || 1, 1, MAX_LEVEL)) });
    return true;
}

/* ---------- бонусы уровня ---------- */
/** Сила бонуса 0..1: плавно растёт от 1 до максимального уровня (чуть быстрее в начале). */
export const bonusOf = level => Math.pow(clamp((level - 1) / (MAX_LEVEL - 1), 0, 1), 0.85);

/** Что даёт уровень (для показа игроку и для расчёта). */
export function perks(level) {
    const b = bonusOf(level);
    return {
        time: 1 + 0.6 * b,              // × к времени
        mistakes: Math.round(3 * b),    // + допустимые ошибки
        tol: 1 + 0.4 * b,               // × допуск рисования
        speed: 1 - 0.2 * b,             // × скорость подсказки (медленнее — легче)
        tierEase: 0.3 * b,              // доп. допуск для сложных символов (до +30% у 5-го ранга)
    };
}

export function perksText(level) {
    const p = perks(level);
    if (level <= 1) return 'Бонусы появятся с ростом уровня';
    const parts = [`время +${Math.round((p.time - 1) * 100)}%`, `форма проще +${Math.round((p.tol - 1) * 100)}%`];
    if (p.mistakes) parts.push(`ошибки +${p.mistakes}`);
    return parts.join(' · ');
}

/** Применяет бонусы текущего уровня чата к параметрам заклинания (мутирует и возвращает params). */
export function applyLevel(params) {
    if (!levelEnabled()) return params;
    const { level } = getLevelState(), p = perks(level);
    params.caster_level = level;
    if (params.time_limit > 0) params.time_limit = Math.round(params.time_limit * p.time);
    params.allowed_mistakes = clamp(params.allowed_mistakes + p.mistakes, 0, 13);
    params.drawing_tolerance = clamp(params.drawing_tolerance * p.tol, 0.08, 0.5);
    params.trace_speed = clamp(params.trace_speed * p.speed, 0.5, 2);
    params.tier_ease = p.tierEase;
    return params;
}

/* ---------- начисление опыта ---------- */
/**
 * Опыт за заклинание: растёт со сложностью и точностью.
 * Слишком простые для текущего уровня заклинания дают меньше опыта.
 * @param r результат computeResult (difficulty, outcome, accuracy 0..100)
 * @returns {{gain:number, before:number, after:number, levelUp:boolean, active:boolean}}
 */
export function awardXp(r) {
    const none = { gain: 0, before: 1, after: 1, levelUp: false, active: false };
    if (!levelEnabled()) return none;
    const slot = readSlot();
    if (!slot) return none;
    const before = levelFromXp(slot.xp);
    none.before = none.after = before; none.active = true;
    if (r.outcome === 'interrupted') return none;

    const diff = clamp(Math.round(r.difficulty) || 1, 1, 5);
    const acc = clamp(r.accuracy / 100, 0, 1);
    let xp = BASE_XP[diff] * (r.outcome === 'fail' ? acc * FAIL_MUL : 0.25 + 0.75 * acc);
    const expected = Math.min(5, 1 + Math.floor((before - 1) / 4));   // «подходящая» сложность для уровня
    if (diff < expected) xp *= Math.pow(0.65, expected - diff);
    const gain = Math.max(0, Math.round(xp));
    if (!gain) return none;

    writeSlot({ xp: slot.xp + gain });
    const after = levelFromXp(slot.xp + gain);
    return { gain, before, after, levelUp: after > before, active: true };
}
