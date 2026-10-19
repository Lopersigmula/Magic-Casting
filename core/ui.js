// Интерфейс: плавающая кнопка, панель, экраны, настройки.
import { getSettings, saveSettings } from './settings.js';
import { Game } from './game.js';
import { prepare, buildSession, computeResult, pushHistory, buildMessage, sendResult } from './state.js';
import { OUTCOME_RU } from './chat.js';
import { DIFF_NAMES } from './difficulty.js';
import { testConnection } from './api.js';
import { getLibrary } from './symbols.js';
import { play } from './fx.js';

const $ = id => document.getElementById(id);
let panel, game, params = null, result = null, view = 'main';

const TEMPLATE = `
<button id="mc-fab" type="button" aria-label="Magic Casting">✦<span id="mc-badge"></span></button>
<div id="mc-panel" class="mc-hidden" data-view="main" role="dialog" aria-label="Magic Casting">
  <div class="mc-shell">
    <header class="mc-head">
      <div class="mc-title">✦ Magic Casting</div>
      <div class="mc-head-btns">
        <button id="mc-btn-settings" type="button" aria-label="Настройки">⚙</button>
        <button id="mc-btn-min" type="button" aria-label="Свернуть">▾</button>
      </div>
    </header>

    <section class="mc-view" data-view="main">
      <label class="mc-label" for="mc-spell">Заклинание или желаемый эффект</label>
      <textarea id="mc-spell" rows="3" maxlength="600" placeholder="Например: Огненный шар, или «создаю барьер из света вокруг отряда»"></textarea>
      <div class="mc-row">
        <label class="mc-label" for="mc-diff">Сложность</label>
        <select id="mc-diff">
          <option value="0">Авто (нейросеть)</option>
          <option value="1">1 — очень легко</option><option value="2">2 — легко</option>
          <option value="3">3 — средне</option><option value="4">4 — сложно</option><option value="5">5 — экстремально</option>
        </select>
      </div>
      <button id="mc-start" class="mc-primary" type="button">Начать кастование</button>
      <div id="mc-notice" class="mc-notice"></div>
      <div class="mc-sub">Недавние заклинания</div>
      <ul id="mc-history" class="mc-history"></ul>
    </section>

    <section class="mc-view" data-view="game">
      <div class="mc-hud">
        <div class="mc-hud-top"><div id="mc-g-name" class="mc-g-name"></div><div id="mc-g-pips" class="mc-pips"></div></div>
        <div class="mc-hud-stats">
          <span id="mc-g-time" class="mc-chip">⏱ —</span>
          <span id="mc-g-err" class="mc-chip">♥ —</span>
          <span id="mc-g-sym" class="mc-chip">Символ —</span>
        </div>
        <div class="mc-bar"><i id="mc-g-prog"></i></div>
      </div>
      <div class="mc-stage"><canvas id="mc-canvas"></canvas></div>
      <div id="mc-g-msg" class="mc-msg"></div>
      <div class="mc-foot">
        <button id="mc-g-cancel" type="button" class="mc-ghost">Отменить</button>
        <button id="mc-g-restart" type="button" class="mc-ghost">↻ Заново</button>
      </div>
    </section>

    <section class="mc-view" data-view="result">
      <div id="mc-r-title" class="mc-r-title"></div>
      <div id="mc-r-spell" class="mc-r-spell"></div>
      <div class="mc-stats">
        <div><b id="mc-r-acc"></b><small>точность</small></div>
        <div><b id="mc-r-err"></b><small>ошибки</small></div>
        <div><b id="mc-r-time"></b><small>время</small></div>
        <div><b id="mc-r-diff"></b><small>сложность</small></div>
      </div>
      <div id="mc-r-extra" class="mc-notice"></div>
      <textarea id="mc-r-text" rows="8"></textarea>
      <div id="mc-r-status" class="mc-notice"></div>
      <div class="mc-actions">
        <button id="mc-r-send" class="mc-primary" type="button">Отправить в чат</button>
        <button id="mc-r-retry" class="mc-ghost" type="button">Повторить попытку</button>
        <button id="mc-r-new" class="mc-ghost" type="button">Новое заклинание</button>
      </div>
    </section>

    <section class="mc-view" data-view="settings">
      <div id="mc-set-body" class="mc-set"></div>
      <button id="mc-set-back" class="mc-primary" type="button">Готово</button>
    </section>
    <div id="mc-toast"></div>
  </div>
</div>`;

/* ---------- настройки ---------- */
const OPT = {
    fail: [['result', 'Показать результат'], ['restart', 'Сразу начать заново']],
    send: [['auto', 'Автоматически'], ['preview', 'Показывать перед отправкой'], ['manual', 'Не отправлять автоматически']],
    mode: [['inject', 'Вписать в последнее сообщение игрока'], ['send', 'Отправить сообщением'], ['send_gen', 'Отправить и запросить ответ ИИ'], ['insert', 'Вставить в поле ввода']],
    anim: [['full', 'Полные'], ['reduced', 'Уменьшенные'], ['off', 'Отключены']],
    api: [['st', 'Подключение SillyTavern'], ['custom', 'Отдельный API (OpenAI-совместимый)']],
};
const FIELDS = [
    { h: 'Сложность и распознавание' },
    { k: 'maxDifficulty', l: 'Максимальный уровень сложности', t: 'range', min: 1, max: 5, step: 1 },
    { k: 'defaultDifficulty', l: 'Сложность по умолчанию (если нет ИИ)', t: 'range', min: 1, max: 5, step: 1 },
    { k: 'manualDifficulty', l: 'Ручной выбор сложности (0 = авто)', t: 'range', min: 0, max: 5, step: 1 },
    { k: 'strictness', l: 'Строгость распознавания', t: 'range', min: 0.6, max: 1.6, step: 0.05 },
    { k: 'extraMistakes', l: 'Поправка к числу допустимых ошибок', t: 'range', min: -2, max: 4, step: 1 },
    { k: 'timerEnabled', l: 'Включить таймер', t: 'check' },
    { k: 'minTime', l: 'Минимальное время, с', t: 'number', min: 3, max: 120 },
    { k: 'maxTime', l: 'Максимальное время, с', t: 'number', min: 5, max: 300 },
    { k: 'failBehavior', l: 'При неудаче', t: 'select', o: OPT.fail },
    { h: 'Влияние результата' },
    { k: 'affectPower', l: 'Учитывать силу заклинания', t: 'check' },
    { k: 'affectSide', l: 'Случайные эффекты при ошибках', t: 'check' },
    { k: 'affectBackfire', l: 'Шанс полного провала при частичном успехе', t: 'check' },
    { h: 'Чат' },
    { k: 'autoSend', l: 'Отправка результата', t: 'select', o: OPT.send },
    { k: 'sendMode', l: 'Способ отправки', t: 'select', o: OPT.mode },
    { k: 'addNote', l: 'Краткое описание результата для ролевой игры', t: 'check' },
    { k: 'includeSpell', l: 'Сохранять исходное описание заклинания', t: 'check' },
    { h: 'Эффекты' },
    { k: 'sound', l: 'Звуковые эффекты', t: 'check' },
    { k: 'animations', l: 'Анимации', t: 'select', o: OPT.anim },
    { h: 'Нейросеть' },
    { k: 'offline', l: 'Режим без API', t: 'check' },
    { k: 'autoAnalyze', l: 'Автоматический анализ заклинаний', t: 'check' },
    { k: 'api.mode', l: 'Источник', t: 'select', o: OPT.api },
    { k: 'api.url', l: 'Адрес API (для отдельного API)', t: 'text', ph: 'https://api.example.com/v1' },
    { k: 'api.key', l: 'API-ключ', t: 'password', ph: 'хранится в настройках SillyTavern' },
    { k: 'api.model', l: 'Название модели', t: 'text' },
    { k: 'api.extra', l: 'Доп. параметры запроса (JSON)', t: 'textarea', ph: '{"top_p":0.9}' },
    { test: true },
];
const getV = (s, k) => k.split('.').reduce((o, p) => o[p], s);
const setV = (s, k, v) => { const a = k.split('.'); const last = a.pop(); a.reduce((o, p) => o[p], s)[last] = v; };

function renderSettings() {
    const s = getSettings(), body = $('mc-set-body');
    body.innerHTML = '';
    for (const f of FIELDS) {
        if (f.h) { body.insertAdjacentHTML('beforeend', `<div class="mc-sub">${f.h}</div>`); continue; }
        if (f.test) {
            body.insertAdjacentHTML('beforeend', '<button id="mc-test" class="mc-ghost" type="button">Проверить подключение</button><div id="mc-test-res" class="mc-notice"></div>');
            continue;
        }
        const v = getV(s, f.k), row = document.createElement('label');
        row.className = 'mc-field' + (f.t === 'check' ? ' mc-check' : '');
        let input;
        if (f.t === 'select') {
            input = document.createElement('select');
            f.o.forEach(([val, txt]) => input.add(new Option(txt, val)));
            input.value = v;
        } else if (f.t === 'textarea') { input = document.createElement('textarea'); input.rows = 2; input.value = v; }
        else {
            input = document.createElement('input');
            input.type = f.t === 'check' ? 'checkbox' : f.t;
            if (f.t === 'check') input.checked = !!v; else input.value = v;
            if (f.min !== undefined) { input.min = f.min; input.max = f.max; if (f.step) input.step = f.step; }
        }
        if (f.ph) input.placeholder = f.ph;
        if (f.t === 'password') input.autocomplete = 'off';
        const out = f.t === 'range' ? `<output>${v}</output>` : '';
        row.innerHTML = `<span>${f.l} ${out}</span>`;
        row.append(input);
        input.addEventListener(f.t === 'range' ? 'input' : 'change', () => {
            let val = f.t === 'check' ? input.checked : (f.t === 'range' || f.t === 'number') ? +input.value : input.value;
            if (f.t === 'number') val = Math.max(f.min, Math.min(f.max, val || f.min));
            setV(s, f.k, val);
            if (f.t === 'range') row.querySelector('output').textContent = val;
            saveSettings(); applyLook();
        });
        body.append(row);
    }
    $('mc-test').addEventListener('click', async () => {
        const out = $('mc-test-res'); out.textContent = 'Проверяю…';
        try { out.textContent = '✓ Подключение работает. Ответ: ' + await testConnection(); }
        catch (e) { out.textContent = '✗ Ошибка: ' + (e && e.message || e); }
    });
}

function applyLook() {
    if (!panel) return;
    panel.dataset.anim = getSettings().animations;
}

/* ---------- вспомогательное ---------- */
function setView(v) { view = v; panel.dataset.view = v; }
function toast(t) {
    const e = $('mc-toast'); e.textContent = t; e.classList.add('show');
    clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('show'), 2600);
}
const pips = n => Array.from({ length: 5 }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('');
const gameActive = () => game && !game.finished && view === 'game';

export function setFabVisible(v) { const f = $('mc-fab'); if (f) f.style.display = v ? '' : 'none'; if (!v) hidePanel(); }
export function openPanel() {
    if (!getSettings().enabled) return;
    panel.classList.remove('mc-hidden');
    document.documentElement.classList.add('mc-lock');
    $('mc-badge').classList.remove('on');
    if (view === 'main') renderHistory();
    if (gameActive()) { game.setPaused(false); game.resize(); }
}
function hidePanel() {
    if (!panel) return;
    panel.classList.add('mc-hidden');
    document.documentElement.classList.remove('mc-lock');
    if (gameActive()) { game.setPaused(true); $('mc-badge').classList.add('on'); }
}

function renderHistory() {
    const ul = $('mc-history'), h = getSettings().history;
    ul.innerHTML = h.length ? '' : '<li class="mc-empty">Пока пусто — сотворите первое заклинание.</li>';
    h.slice(0, 8).forEach(x => {
        const li = document.createElement('li');
        li.className = 'mc-h-' + x.outcome;
        li.innerHTML = `<span class="n"></span><span class="r">${OUTCOME_RU[x.outcome]} · ${x.accuracy}% · ${x.difficulty}/5</span>`;
        li.firstChild.textContent = x.spell;
        li.title = 'Нажмите, чтобы повторить это заклинание';
        li.addEventListener('click', () => { $('mc-spell').value = x.descFull || x.spell; });
        ul.append(li);
    });
}

/* ---------- ход кастования ---------- */
async function onStart() {
    const desc = $('mc-spell').value.trim();
    const notice = $('mc-notice');
    if (!desc) { notice.textContent = 'Введите название или описание заклинания.'; return; }
    const btn = $('mc-start');
    btn.disabled = true; btn.textContent = 'Нейросеть оценивает сложность…'; notice.textContent = '';
    try {
        const r = await prepare(desc, +$('mc-diff').value);
        params = r.params; params.desc = desc;
        launch(r.notice);
    } finally { btn.disabled = false; btn.textContent = 'Начать кастование'; }
}

function launch(notice) {
    const s = getSettings();
    $('mc-notice').textContent = notice || '';
    setView('game');
    $('mc-g-name').textContent = params.spell_name;
    $('mc-g-pips').innerHTML = pips(params.difficulty);
    $('mc-g-pips').title = DIFF_NAMES[params.difficulty];
    $('mc-g-msg').textContent = params.complexity_reason || (notice ? notice : 'Проведите пальцем по линии от отмеченной точки.');
    $('mc-g-msg').className = 'mc-msg';
    $('mc-g-prog').style.width = '0%';
    const session = buildSession(params);
    requestAnimationFrame(() => game.start(session));
    if (notice) toast(notice);
}

function callbacks() {
    const s = () => getSettings();
    return {
        onSymbol: i => {
            $('mc-g-sym').textContent = `Символ ${i.symIdx + 1}/${i.symTotal} · ${i.name}`;
            $('mc-g-err').textContent = '♥ ' + Math.max(0, i.allowed - i.mistakes);
            $('mc-g-err').classList.toggle('warn', i.allowed - i.mistakes <= 0);
            $('mc-g-time').textContent = i.limit ? '⏱ ' + Math.ceil(i.timeLeft) : '⏱ ∞';
        },
        onTick: t => {
            if (params.time_limit) {
                $('mc-g-time').textContent = '⏱ ' + Math.ceil(t.timeLeft);
                $('mc-g-time').classList.toggle('warn', t.timeLeft <= 5);
            }
            $('mc-g-prog').style.width = Math.round(t.progress * 100) + '%';
        },
        onFeedback: f => {
            const m = $('mc-g-msg'); m.textContent = f.text; m.className = 'mc-msg ' + (f.ok ? 'ok' : 'bad');
            play(f.ok ? 'ok' : 'bad', s().sound);
            if (!f.ok && s().animations !== 'off' && navigator.vibrate) navigator.vibrate(50);
        },
        onSymbolDone: () => { play('ok', s().sound); $('mc-g-prog').style.width = '100%'; },
        onFinish: g => {
            const r = computeResult(params, params.desc, g);
            pushHistory(r);
            result = r;
            if (r.outcome === 'fail' && s().failBehavior === 'restart' && g.kind === 'failed') {
                toast('Заклинание сорвалось — новая попытка'); play('lose', s().sound);
                setTimeout(() => game.restart(), 500); return;
            }
            showResult(r);
        },
    };
}

function showResult(r) {
    const s = getSettings();
    setView('result');
    play(r.outcome === 'full' || r.outcome === 'partial' ? 'win' : 'lose', s.sound);
    panel.dataset.outcome = r.outcome;
    $('mc-r-title').textContent = OUTCOME_RU[r.outcome];
    $('mc-r-spell').textContent = r.spell;
    $('mc-r-acc').textContent = r.accuracy + '%';
    $('mc-r-err').textContent = r.mistakes;
    $('mc-r-time').textContent = r.time.toFixed(1) + ' с';
    $('mc-r-diff').textContent = r.difficulty + '/5';
    const bits = [`Символов: ${r.symbolsDone}/${r.symbolsTotal}`];
    if (r.reason === 'timeout') bits.push('время вышло');
    if (r.reason === 'mistakes') bits.push('превышен лимит ошибок');
    if (s.affectPower && (r.outcome === 'full' || r.outcome === 'partial')) bits.push('сила ' + r.power + '%');
    if (r.side) bits.push('эффект: ' + r.side);
    if (r.backfire) bits.push('заклинание схлопнулось в последний миг');
    $('mc-r-extra').textContent = bits.join(' · ');
    const ta = $('mc-r-text'), st = $('mc-r-status');
    st.textContent = '';
    ta.value = buildMessage(r);
    ta.style.display = s.autoSend === 'preview' ? '' : 'none';
    $('mc-r-send').disabled = false;
    $('mc-r-send').textContent = s.sendMode === 'insert' ? 'Вставить в поле ввода' : s.sendMode === 'inject' ? 'Вписать в сообщение' : 'Отправить в чат';
    if (s.autoSend === 'auto') doSend();
}

async function doSend() {
    const st = $('mc-r-status'), ta = $('mc-r-text');
    $('mc-r-send').disabled = true;
    try {
        const text = ta.style.display === 'none' ? undefined : ta.value;
        const status = await sendResult(result, text);
        const retry = status === 'nochat' || status === 'nouser';
        st.textContent = status === 'nochat' ? 'Откройте чат с персонажем, затем нажмите кнопку ещё раз.'
            : status === 'nouser' ? 'В чате нет сообщения игрока — отправьте сообщение и повторите.'
            : status === 'injected' ? '✓ Результат вписан в последнее сообщение игрока.' : status === 'inserted' ? 'Результат вставлен в поле ввода сообщения.' : '✓ Результат отправлен в чат.';
        if (retry) $('mc-r-send').disabled = false;
    } catch (e) {
        st.textContent = 'Не удалось отправить: ' + (e && e.message || e);
        $('mc-r-send').disabled = false;
    }
}

/* ---------- инициализация ---------- */
export function initUI() {
    document.body.insertAdjacentHTML('beforeend', TEMPLATE);
    panel = $('mc-panel');
    applyLook();
    game = new Game($('mc-canvas'), callbacks());

    $('mc-fab').addEventListener('click', () => (panel.classList.contains('mc-hidden') ? openPanel() : hidePanel()));
    $('mc-btn-min').addEventListener('click', hidePanel);
    $('mc-btn-settings').addEventListener('click', () => {
        if (view === 'game') { toast('Сначала завершите или отмените кастование'); return; }
        if (view === 'settings') { setView('main'); return; }
        renderSettings(); setView('settings');
    });
    $('mc-set-back').addEventListener('click', () => { setView('main'); renderHistory(); });
    $('mc-start').addEventListener('click', onStart);
    $('mc-g-cancel').addEventListener('click', () => game.cancel());
    $('mc-g-restart').addEventListener('click', () => { game.restart(); $('mc-g-msg').textContent = 'Новая попытка.'; });
    $('mc-r-send').addEventListener('click', doSend);
    $('mc-r-retry').addEventListener('click', () => { setView('game'); requestAnimationFrame(() => game.restart()); });
    $('mc-r-new').addEventListener('click', () => { setView('main'); renderHistory(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && !panel.classList.contains('mc-hidden')) hidePanel(); });
    renderHistory();
    console.log(`[Magic Casting] загружено, символов: ${getLibrary().length}`);
}
