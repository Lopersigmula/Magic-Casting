// Анализ заклинания нейросетью. Один запрос на заклинание; ключ нигде не логируется.
import { getContext } from './st.js';
import { getLibrary } from './symbols.js';
import { getSettings } from './settings.js';

function systemPrompt() {
    const ids = getLibrary().map(s => `${s.id}(tier ${s.tier})`).join(', ');
    return [
        'You rate the difficulty of a spell for a finger-drawing minigame in a roleplay.',
        'Judge the effect, scale, precision required and implied magical power.',
        'Reply with ONE JSON object and nothing else (no markdown, no comments):',
        '{"spell_name":string,"difficulty":1-5,"symbol_count":1-6,"symbols":[ids],"time_limit":seconds,"allowed_mistakes":0-8,"drawing_tolerance":0.08-0.35,"trace_speed":0.5-2,"complexity_reason":string}',
        'Scale: 1 trivial (light), 2 easy, 3 moderate (barrier), 4 hard (spatial), 5 extreme (massive effect).',
        'Higher difficulty = more symbols, less time, fewer mistakes, smaller tolerance.',
        'You may ONLY choose symbols from this list of ids, never invent new ones: ' + ids + '.',
    ].join('\n');
}

export function extractJson(text) {
    if (typeof text !== 'string') throw new Error('Пустой ответ');
    const t = text.replace(/```json|```/gi, '');
    const a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('В ответе нет JSON');
    return JSON.parse(t.slice(a, b + 1));
}

async function viaST(user, system) {
    const ctx = getContext();
    const gen = ctx.generateRaw;
    if (typeof gen !== 'function') throw new Error('generateRaw недоступен в этой версии SillyTavern');
    const out = gen.length >= 2
        ? await gen(user, null, false, false, system)          // старая сигнатура
        : await gen({ prompt: user, systemPrompt: system });   // новая сигнатура
    return typeof out === 'string' ? out : String(out ?? '');
}

async function viaCustom(user, system, api) {
    if (!api.url) throw new Error('Не указан адрес API');
    let url = api.url.trim().replace(/\/+$/, '');
    if (!/\/chat\/completions$/.test(url)) url += '/chat/completions';
    let extra = {};
    if (api.extra && api.extra.trim()) {
        try { extra = JSON.parse(api.extra); } catch { throw new Error('Дополнительные параметры: некорректный JSON'); }
    }
    const body = { model: api.model || undefined, temperature: 0.3, max_tokens: 400, ...extra,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }] };
    const headers = { 'Content-Type': 'application/json' };
    if (api.key) headers.Authorization = 'Bearer ' + api.key;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
        const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const j = await r.json();
        return j?.choices?.[0]?.message?.content ?? j?.content?.[0]?.text ?? '';
    } finally { clearTimeout(timer); }
}

async function ask(user, system) {
    const api = getSettings().api;
    return api.mode === 'custom' ? viaCustom(user, system, api) : viaST(user, system);
}

export async function analyzeSpell(description) {
    const text = await ask('Spell: ' + description.slice(0, 600), systemPrompt());
    return extractJson(text);
}

export async function testConnection() {
    const text = await ask('Reply with the single word OK.', 'You are a connection test. Reply with OK only.');
    if (!text || !String(text).trim()) throw new Error('Пустой ответ');
    return String(text).trim().slice(0, 40);
}
