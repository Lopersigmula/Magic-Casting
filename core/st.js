// Единственная точка контакта с внутренними модулями SillyTavern.
import { extension_settings, getContext } from '../../../../extensions.js';

export const MODULE = 'magic_casting';
export { extension_settings, getContext };

export function persist() {
    try { getContext().saveSettingsDebounced(); }
    catch (e) { console.warn('[Magic Casting] не удалось сохранить настройки', e); }
}
