// Передача результата в чат SillyTavern: вписывание в последнее сообщение игрока или слэш-команды.
import { getContext } from './st.js';

export const OUTCOME_EN = { full: 'Full Success', partial: 'Partial Success', fail: 'Failure', interrupted: 'Interrupted' };
export const OUTCOME_RU = { full: 'Полный успех', partial: 'Частичный успех', fail: 'Неудача', interrupted: 'Прерывание' };
const NOTE = {
    full: 'The caster completed the spell cleanly; it takes full effect.',
    partial: 'The spell was completed but flawed; its effect is weaker or imperfect.',
    fail: 'The casting failed; the spell does not take effect.',
    interrupted: 'The caster broke off the casting; the spell is not completed.',
};

/** Характеристики результата (английский — для нейросети, ведущей игру). */
function characteristics(r, s, includeSpell) {
    const L = [`Result: ${OUTCOME_EN[r.outcome]}`, `Difficulty: ${r.difficulty}/5`, `Accuracy: ${r.accuracy}%`,
        `Errors: ${r.mistakes}`, `Casting Time: ${r.time.toFixed(1)} seconds`];
    if (s.affectPower && (r.outcome === 'full' || r.outcome === 'partial')) L.push(`Spell Power: ${r.power}%`);
    if (s.affectSide && r.effect) L.push(`Random Effect (${r.side}): ${r.effect}`);
    if (r.backfire) L.push('Backfire: the spell collapsed at the last moment');
    if (s.addNote) L.push('Note: ' + NOTE[r.outcome]);
    if (includeSpell && s.includeSpell && r.desc) L.push('Original description: ' + r.desc);
    return L;
}

/** > ⭐️ **Заклинание:** *Точность N%. Случайный эффект.* <span hidden system_note> */
export function formatInject(r, s, includeSpell) {
    const eff = s.affectSide && r.effect ? ` Случайный эффект: ${r.effect}.` : '';
    return `> ⭐️ **${r.spell}:** *Точность ${r.accuracy}%.${eff}* <span style="display:none;">\n<system_note>\n${characteristics(r, s, includeSpell).join('\n')}\n</system_note>\n</span>`;
}

export function formatResult(r, s, includeSpell) {
    const L = ['[Magic Casting Result]', `Spell: ${r.spell}`, ...characteristics(r, s, includeSpell)];
    return L.join('\n');
}

const esc = t => t.replace(/\|/g, '\\|').replace(/\{\{/g, '{ {');

/** @returns 'injected' | 'sent' | 'inserted' | 'nochat' | 'nouser' */
export async function sendToChat(text, mode) {
    const ctx = getContext();
    if (mode === 'inject') return injectIntoLastUser(ctx, text);
    const hasChat = ctx.chatId !== undefined || ctx.characterId !== undefined || ctx.groupId;
    if (mode !== 'insert') {
        if (!hasChat) return 'nochat';
        if (typeof ctx.executeSlashCommandsWithOptions === 'function') {
            const cmd = `/send ${esc(text)}` + (mode === 'send_gen' ? ' | /trigger' : '');
            await ctx.executeSlashCommandsWithOptions(cmd, { showOutput: false });
            return 'sent';
        }
    }
    const ta = document.getElementById('send_textarea');
    if (!ta) throw new Error('Поле ввода чата не найдено');
    ta.value = (ta.value ? ta.value + '\n' : '') + text;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    return 'inserted';
}

/** Дописывает блок в последнее сообщение игрока — только по явному действию пользователя. */
async function injectIntoLastUser(ctx, text) {
    const chat = ctx.chat;
    if (!Array.isArray(chat) || !chat.length) return 'nochat';
    let id = -1;
    for (let i = chat.length - 1; i >= 0; i--) if (chat[i].is_user && !chat[i].is_system) { id = i; break; }
    if (id < 0) return 'nouser';
    const m = chat[id];
    m.mes = (m.mes ? m.mes.replace(/\s+$/, '') + '\n\n' : '') + text;
    if (Array.isArray(m.swipes) && m.swipe_id !== undefined && m.swipes[m.swipe_id] !== undefined) m.swipes[m.swipe_id] = m.mes;
    if (typeof ctx.updateMessageBlock === 'function') ctx.updateMessageBlock(id, m);
    try { await ctx.eventSource?.emit(ctx.eventTypes?.MESSAGE_EDITED, id); } catch { /* не критично */ }
    if (typeof ctx.saveChat === 'function') await ctx.saveChat();
    return 'injected';
}
