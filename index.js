// Точка входа расширения Magic Casting для SillyTavern.
import { getSettings, saveSettings } from './core/settings.js';
import { loadExtraSymbols } from './core/symbols.js';
import { initUI, openPanel, setFabVisible } from './core/ui.js';

jQuery(async () => {
    try {
        const s = getSettings();
        await loadExtraSymbols(new URL('./data/user-symbols.json', import.meta.url));
        initUI();
        setFabVisible(s.enabled);

        // Блок в настройках расширений SillyTavern
        const html = `
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>Magic Casting</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <label class="checkbox_label"><input type="checkbox" id="mc_enabled"><span>Включить расширение</span></label>
                <div id="mc_open_btn" class="menu_button menu_button_icon"><i class="fa-solid fa-wand-sparkles"></i><span>Открыть Magic Casting</span></div>
                <small>Все параметры — в панели (кнопка ⚙).</small>
            </div>
        </div>`;
        jQuery('#extensions_settings2').append(html);
        jQuery('#mc_enabled').prop('checked', s.enabled).on('change', function () {
            s.enabled = this.checked; saveSettings(); setFabVisible(s.enabled);
        });
        jQuery('#mc_open_btn').on('click', () => openPanel());

        // Пункт в меню расширений (если оно есть)
        const menu = jQuery('#extensionsMenu');
        if (menu.length) {
            menu.append('<div id="mc_menu_item" class="list-group-item flex-container flexGap5"><div class="fa-solid fa-wand-sparkles extensionsMenuExtensionButton"></div>Magic Casting</div>');
            jQuery('#mc_menu_item').on('click', () => openPanel());
        }
    } catch (e) {
        console.error('[Magic Casting] ошибка инициализации', e);
    }
});
