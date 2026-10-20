import { extension_settings, persist, MODULE } from './st.js';

export const DEFAULTS = {
    v: 2,
    enabled: true,
    maxDifficulty: 5,
    defaultDifficulty: 2,
    manualDifficulty: 0,        // 0 = авто
    strictness: 1.0,
    extraMistakes: 0,
    timerEnabled: true,
    minTime: 10,
    maxTime: 60,
    failBehavior: 'result',     // result | restart
    affectPower: true,
    affectSide: true,
    affectBackfire: false,
    autoSend: 'preview',        // auto | preview | manual
    sendMode: 'inject',         // inject | send | send_gen | insert
    sound: true,
    soundVolume: 0.7,
    shake: true,                // дрожание в конце символа
    animations: 'full',         // full | reduced | off
    levelEnabled: true,         // система уровней (опыт отдельно для каждого чата)
    levelsByChat: {},           // запасное хранилище, если у чата нет метаданных
    offline: false,
    autoAnalyze: true,
    api: { mode: 'st', url: '', key: '', model: '', extra: '' },
    history: [],
};

export function getSettings() {
    if (!extension_settings[MODULE]) extension_settings[MODULE] = {};
    const s = extension_settings[MODULE];
    for (const k of Object.keys(DEFAULTS)) {
        if (s[k] === undefined) s[k] = JSON.parse(JSON.stringify(DEFAULTS[k]));
    }
    for (const k of Object.keys(DEFAULTS.api)) if (s.api[k] === undefined) s.api[k] = DEFAULTS.api[k];
    if (!Array.isArray(s.history)) s.history = [];
    if ((s.v || 0) < 2) { s.sendMode = 'inject'; s.affectSide = true; s.v = 2; }   // миграция
    return s;
}

export const saveSettings = persist;
