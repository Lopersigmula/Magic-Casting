// Менеджер кастования: подготовка параметров, расчёт результата, история, отправка в чат.
import { getSettings, saveSettings } from './settings.js';
import { getSymbol } from './symbols.js';
import { analyzeSpell } from './api.js';
import { buildParams } from './difficulty.js';
import { formatResult, formatInject, sendToChat } from './chat.js';

export const FULL_ACC = 0.72;     // порог полного успеха
export const PARTIAL_ACC = 0.40;  // порог частичного успеха

/** Возвращает { params, notice }. Никогда не бросает исключений: при сбое — безопасные значения. */
export async function prepare(desc, uiLevel) {
    const s = getSettings();
    const name = desc.length > 40 ? desc.slice(0, 38) + '…' : desc;
    const manual = uiLevel > 0 ? uiLevel : s.manualDifficulty;
    if (manual > 0) return { params: buildParams(null, s, { level: manual, name, source: 'manual', desc }), notice: '' };
    if (s.offline || !s.autoAnalyze) {
        return { params: buildParams(null, s, { level: s.defaultDifficulty, name, source: 'default', desc }),
            notice: 'Анализ отключён — использована сложность по умолчанию.' };
    }
    try {
        const raw = await analyzeSpell(desc);
        return { params: buildParams(raw, s, { name, source: 'ai', desc }), notice: '' };
    } catch (e) {
        console.warn('[Magic Casting] анализ не удался:', e && e.message);
        return { params: buildParams(null, s, { level: s.defaultDifficulty, name, source: 'default', desc }),
            notice: 'Нейросеть недоступна или ответила некорректно — сложность по умолчанию. Выберите уровень вручную, если нужно.' };
    }
}

export function buildSession(params) {
    const s = getSettings();
    return { params, symbols: params.symbols.map(getSymbol).filter(Boolean),
        opts: { anim: s.animations, strictness: s.strictness, shake: s.shake } };
}

/** Итог рассчитывает только движок — по фактическим данным мини-игры. */
const EFFECTS = {
    minor: ['лёгкая рябь маны', 'короткая вспышка искр', 'тихий звон в воздухе'],
    moderate: ['выброс нестабильной маны', 'мерцание и помехи вокруг', 'мимолётная слабость кастера'],
    severe: ['сильная отдача', 'ожог от сорвавшейся маны', 'хаотичный всплеск энергии'],
};
const rnd = a => a[Math.floor(Math.random() * a.length)];

export function computeResult(params, desc, g) {
    const s = getSettings();
    const total = params.symbol_count || g.symbolsTotal;
    const accuracy = g.scores.reduce((a, b) => a + b, 0) / total;
    let outcome;
    if (g.kind === 'cancel') outcome = 'interrupted';
    else if (g.kind === 'failed') outcome = 'fail';
    else if (accuracy >= FULL_ACC && g.mistakes <= Math.floor(params.allowed_mistakes / 3)) outcome = 'full';
    else if (accuracy >= PARTIAL_ACC) outcome = 'partial';
    else outcome = 'fail';

    let backfire = false;
    if (s.affectBackfire && outcome === 'partial' && Math.random() < (1 - accuracy) * 0.5) { backfire = true; outcome = 'fail'; }
    let side = '';
    if (s.affectSide && (outcome === 'partial' || outcome === 'fail') && g.kind !== 'cancel') side = accuracy < 0.25 ? 'severe' : accuracy < 0.55 ? 'moderate' : 'minor';
    const effect = side ? rnd(EFFECTS[side]) : '';
    const power = outcome === 'full' ? Math.round(80 + accuracy * 20) : outcome === 'partial' ? Math.round(accuracy * 100 * 0.8) : 0;

    return { spell: params.spell_name, effect, desc, difficulty: params.difficulty, outcome, backfire,
        accuracy: Math.round(accuracy * 100), mistakes: g.mistakes, time: g.elapsed,
        reason: g.reason, symbolsDone: g.symbolsDone, symbolsTotal: g.symbolsTotal,
        power: s.affectPower ? power : 100, side, effect, ts: Date.now(), sent: false };
}

const norm = t => t.trim().toLowerCase().replace(/\s+/g, ' ');

export function wasDescSent(desc) {
    return getSettings().history.some(h => h.sent && norm(h.descFull || '') === norm(desc));
}

export function pushHistory(r) {
    const s = getSettings();
    s.history.unshift({ spell: r.spell, descFull: r.desc, difficulty: r.difficulty, outcome: r.outcome,
        accuracy: r.accuracy, mistakes: r.mistakes, time: r.time, ts: r.ts, sent: false });
    s.history.length = Math.min(s.history.length, 20);
    saveSettings();
}

export function buildMessage(r) {
    const s = getSettings();
    const inc = !wasDescSent(r.desc);
    return s.sendMode === 'inject' ? formatInject(r, s, inc) : formatResult(r, s, inc);   // описание заклинания не дублируем
}

export async function sendResult(r, text) {
    const s = getSettings();
    const status = await sendToChat(text ?? buildMessage(r), s.sendMode);
    if (status !== 'nochat' && status !== 'nouser') {
        r.sent = true;
        const h = s.history.find(x => x.ts === r.ts);
        if (h) h.sent = true;
        saveSettings();
    }
    return status;
}
