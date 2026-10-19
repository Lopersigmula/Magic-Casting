// Простые звуки через WebAudio (без файлов).
let ac = null;
function tone(f, t0, dur, type = 'sine', vol = 0.06) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(vol, ac.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + t0 + dur);
    o.connect(g).connect(ac.destination);
    o.start(ac.currentTime + t0); o.stop(ac.currentTime + t0 + dur + 0.02);
}
export function play(kind, enabled) {
    if (!enabled) return;
    try {
        ac = ac || new (window.AudioContext || window.webkitAudioContext)();
        if (ac.state === 'suspended') ac.resume();
        if (kind === 'ok') tone(660, 0, 0.12);
        else if (kind === 'bad') tone(170, 0, 0.2, 'sawtooth', 0.04);
        else if (kind === 'win') [523, 659, 784, 1047].forEach((f, i) => tone(f, i * 0.09, 0.25));
        else if (kind === 'lose') [330, 247, 185].forEach((f, i) => tone(f, i * 0.12, 0.3, 'triangle'));
    } catch { /* звук необязателен */ }
}
