// Передача результата в чат SillyTavern: вписывание в последнее сообщение игрока или слэш-команды.
import { getContext } from './st.js';

export const OUTCOME_EN = { full: 'Full Success', partial: 'Partial Success', fail: 'Failure', interrupted: 'Interrupted' };
export const OUTCOME_RU = { full: 'Полный успех', partial: 'Частичный успех', fail: 'Неудача', interrupted: 'Прерывание' };
/** Единый формат результата (английский — для нейросети, ведущей игру). */
function characteristics(r) {
    const L = ['Result: ' + OUTCOME_EN[r.outcome], 'Difficulty: ' + r.difficulty + '/5', 'Accuracy: ' + r.accuracy + '%',
        'Errors: ' + r.mistakes, 'Casting Time: ' + r.time.toFixed(1) + ' seconds', 'Spell Power: ' + r.power + '%'];
    const note = [];
    if (r.effect) note.push(`random effect${r.side ? ' (' + r.side + ')' : ''}: ${r.effect}`);
    if (r.backfire) note.push('the spell collapsed at the last moment');
    if (note.length) L.push('Note: ' + note.join('; '));
    return L;
}

/**
 * > ⭐️ **Название:** *Сила заклинания: N%.* <span hidden system_note>
 * Один и тот же вид для всех способов отправки.
 */
export function formatResult(r) {
    return `> ⭐️ **${r.spell}:** *Сила заклинания: ${r.power}%.* <span style="display:none;">\n<system_note>\n${characteristics(r).join('\n')}\n</system_note>\n</span>`;
}
export const formatInject = formatResult;

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
