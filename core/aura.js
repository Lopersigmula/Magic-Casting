// Аура заклинания: палитра, тип частиц и характер «дыма». Описывается нейросетью вместе с анализом
// сложности; если ответа нет — подбирается локально по ключевым словам. Чистые функции + пара хелперов Canvas.

export const RAMP_N = 16;
export const PARTICLES = ['spark', 'ember', 'mist', 'snow', 'leaf', 'rune', 'bubble', 'star', 'shard'];

/** Параметры частиц: g — гравитация (px/с², минус = вверх), drag — затухание, size/life — диапазоны. */
export const KIND = {
    spark: { g: 0, drag: 2.2, size: [1.2, 2.4], life: [0.35, 0.7], drift: [0, -4] },
    ember: { g: -55, drag: 1.2, size: [2, 4], life: [0.8, 1.6], drift: [0, -16] },
    mist: { g: -8, drag: 1.5, size: [14, 30], life: [1.2, 2.2], drift: [7, -6], alpha: 0.2, grow: 1.4 },
    snow: { g: 30, drag: 1.0, size: [1.6, 3.2], life: [1, 2], drift: [0, 9] },
    leaf: { g: 18, drag: 1.3, size: [3, 5], life: [1.2, 2.2], spin: 5, drift: [6, 5] },
    rune: { g: -10, drag: 1.5, size: [3, 5], life: [1, 1.8], spin: 2, drift: [0, -8] },
    bubble: { g: -35, drag: 1.1, size: [3, 7], life: [1, 1.9], drift: [0, -10] },
    star: { g: 0, drag: 1.5, size: [2.5, 4.5], life: [0.8, 1.5], drift: [0, -3] },
    shard: { g: 60, drag: 0.6, size: [2, 4], life: [0.6, 1.2], spin: 8, drift: [0, 6] },
};

export const ELEMENTS = {
    fire: { ru: 'Огонь', colors: ['#ff5a1f', '#ffb703', '#ff2d55'], particle: 'ember', turb: 0.7,
        re: /огн|огон|пламя|пламен|жар|пепел|лав[аыу]|взрыв|инферно|поджог|сожг|fire|flame|burn|lava|explo|inferno|blaze/ },
    ice: { ru: 'Лёд', colors: ['#9be7ff', '#e0f7ff', '#5aa9ff'], particle: 'snow', turb: 0.35,
        re: /лёд|лед[яо]|льд|мороз|снег|холод|заморо|вьюг|ice|frost|snow|freez|blizzard|glacier/ },
    water: { ru: 'Вода', colors: ['#2ec4ff', '#1b6dff', '#7df3e1'], particle: 'bubble', turb: 0.5,
        re: /вод[аыуе]|водян|океан|волн|дожд|прилив|шторм|поток|water|ocean|wave|rain|tide|aqua|storm|flood/ },
    lightning: { ru: 'Молния', colors: ['#fff27a', '#7aa8ff', '#c9b6ff'], particle: 'spark', turb: 0.9,
        re: /молни|гром|электр|разряд|грозa|гроза|lightning|thunder|electr|shock|bolt/ },
    earth: { ru: 'Земля', colors: ['#d9a55b', '#9a6b35', '#f0dca4'], particle: 'shard', turb: 0.3,
        re: /земл|камн|камен|скал|песок|кристалл|гор[аыу]|стен[аы] из|earth|stone|rock|sand|crystal|quake|mountain/ },
    wind: { ru: 'Ветер', colors: ['#c8fff0', '#8fe3ff', '#ffffff'], particle: 'mist', turb: 0.85,
        re: /ветер|ветр|воздух|ураган|вихр|торнадо|порыв|wind|air|tornado|gust|cyclone|breeze/ },
    light: { ru: 'Свет', colors: ['#fff4b8', '#ffd166', '#ffffff'], particle: 'star', turb: 0.3,
        re: /свет|свят|исцел|лечен|благослов|луч|солн|сияни|свеч|light|holy|heal|bless|radiant|sun|divine|sacred/ },
    dark: { ru: 'Тьма', colors: ['#a24dff', '#5b21b6', '#e07bff'], particle: 'mist', turb: 0.6,
        re: /тьм|тен[ьи]|мрак|ноч|проклят|смерт|некро|пустот|призрак|dark|shadow|night|curse|death|necro|void|ghost|abyss/ },
    nature: { ru: 'Природа', colors: ['#5df28a', '#a3e635', '#1fb57a'], particle: 'leaf', turb: 0.5,
        re: /природ|лес[аунй]|растен|лоз|корн|цвет|плющ|яд[аоу]|трав|nature|vine|root|bloom|forest|poison|plant|thorn|druid/ },
    blood: { ru: 'Кровь', colors: ['#ff1744', '#b0001f', '#ff7a90'], particle: 'ember', turb: 0.55,
        re: /кров|вампир|багров|blood|vampir|crimson/ },
    arcane: { ru: 'Магия', colors: ['#5ee7ff', '#a78bfa', '#f0abfc'], particle: 'rune', turb: 0.5, re: null },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : (+v && isFinite(+v) ? +v : d));

function parseHex(h) {
    if (typeof h !== 'string') return null;
    const m = h.trim().match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    let s = m[1];
    if (s.length === 3) s = [...s].map(c => c + c).join('');
    return '#' + s.toLowerCase();
}
const toRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const toHex = rgb => '#' + rgb.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
const lum = rgb => (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;

/** Тёмные цвета от ИИ не светятся на тёмном фоне — слегка подмешиваем белый. */
function brighten(hex) {
    let rgb = toRgb(hex);
    for (let i = 0; i < 4 && lum(rgb) < 0.38; i++) rgb = rgb.map(v => v + (255 - v) * 0.22);
    return toHex(rgb);
}

export function guessElement(desc) {
    const t = String(desc || '').toLowerCase();
    for (const [name, def] of Object.entries(ELEMENTS)) if (def.re && def.re.test(t)) return name;
    return 'arcane';
}

/** Собирает безопасную ауру из «сырого» ответа ИИ (или без него). */
export function buildAura(raw, desc, level = 3) {
    raw = raw && typeof raw === 'object' ? raw : {};
    const element = ELEMENTS[raw.element] ? raw.element : guessElement(desc);
    const base = ELEMENTS[element];
    let colors = Array.isArray(raw.colors) ? raw.colors.map(parseHex).filter(Boolean).slice(0, 3) : [];
    const fromAI = colors.length >= 2;
    for (let i = colors.length; i < 3; i++) colors.push(fromAI ? colors[i % colors.length] : base.colors[i]);
    if (!fromAI) colors = base.colors.slice();
    colors = colors.map(brighten);
    return {
        element,
        label: base.ru,
        colors,
        particle: PARTICLES.includes(raw.particle) ? raw.particle : base.particle,
        energy: clamp(num(raw.energy, 0.35 + 0.12 * level), 0.1, 1),
        turbulence: clamp(num(raw.turbulence, base.turb), 0, 1),
        smudge: clamp(num(raw.smudge, element === 'earth' || element === 'ice' ? 0.45 : 0.7), 0.2, 1),
        fromAI,
    };
}

/** Плавный цикл палитры: c0 → c1 → c2 → c0, RAMP_N шагов, массивы [r,g,b]. */
export function buildRamp(colors, n = RAMP_N) {
    const rgb = colors.map(toRgb);
    const cyc = [rgb[0], rgb[1], rgb[2], rgb[0]];
    const out = [];
    for (let i = 0; i < n; i++) {
        const t = (i / n) * 3, k = Math.min(2, Math.floor(t)), f = t - k;
        out.push(cyc[k].map((v, j) => Math.round(v + (cyc[k + 1][j] - v) * f)));
    }
    return out;
}
export const rgbStr = c => `rgb(${c[0]},${c[1]},${c[2]})`;

/** Мягкое светящееся пятно с горячим центром (рисуется drawImage — дёшево). */
export function makeSprite(rgb, size = 64) {
    const cv = document.createElement('canvas'); cv.width = cv.height = size;
    const g = cv.getContext('2d'), h = size / 2;
    const hot = rgb.map(v => v + (255 - v) * 0.6);
    const gr = g.createRadialGradient(h, h, 0, h, h, h);
    gr.addColorStop(0, `rgba(${hot.map(Math.round)},1)`);
    gr.addColorStop(0.28, `rgba(${rgb},0.75)`);
    gr.addColorStop(0.65, `rgba(${rgb},0.22)`);
    gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return cv;
}
