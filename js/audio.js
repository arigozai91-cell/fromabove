/* =============================================
   AUDIO.JS — Web Audio API sound system
   ============================================= */
'use strict';

const AudioSystem = (() => {
  let ctx = null;
  let masterGain = null;
  let menuMusicGain = null;
  let explosionGain = null;
  let initialized = false;
  let missileLockMode = 'off';
  let missileLockInterval = null;
  let activeMissionVoiceCount = 0;
  let masterVolume = 0.5;
  let menuMusicVolume = 0.45;
  let explosionVolume = 0.7;
  let menuMusicEnabled = false;
  let menuMusicAudio = null;
  let menuMusicSource = null;
  let menuMusicStopTimer = null;
  let lastMenuMusicTrack = null;

  const SOUND_ROOT = 'Sounds';
  const IMAGE_ROOT = 'image';
  const MASTER_VOLUME_STORAGE_KEY = 'ac130_master_volume';
  const MENU_MUSIC_VOLUME_STORAGE_KEY = 'ac130_menu_music_volume';
  const EXPLOSION_VOLUME_STORAGE_KEY = 'ac130_explosion_volume';

  function soundPath(relativePath) {
    return `${SOUND_ROOT}/${relativePath}`;
  }

  function imagePath(relativePath) {
    return `${IMAGE_ROOT}/${relativePath}`;
  }

  const SPEAKER_PORTRAITS = {
    general: imagePath('General.png'),
    soldier: imagePath('Soldier.png'),
    radioOperator: imagePath('RadioOperator.png')
  };

  const START_VOICE_ALIASES = {
    laststand: soundPath('StartVoice/LastStand.mp3'),
    convoyintercept: soundPath('StartVoice/Convoy.mp3'),
    deadwave: soundPath('StartVoice/Deadwave.mp3'),
    delta: soundPath('StartVoice/Delta.mp3'),
    deltasquad: soundPath('StartVoice/Delta.mp3'),
    basedefence: soundPath('StartVoice/BaseDefence.mp3'),
    basedefense: soundPath('StartVoice/BaseDefence.mp3')
  };

  const RANDOM_VOICE_FILES = [
    soundPath('RandomVoice/Airsupport.mp3'),
    soundPath('RandomVoice/Airsupport2.mp3'),
    soundPath('RandomVoice/Airsupport3.mp3'),
    soundPath('RandomVoice/Airsupport4.mp3'),
    soundPath('RandomVoice/Random.mp3'),
    soundPath('RandomVoice/Random2.mp3'),
    soundPath('RandomVoice/Random3.mp3'),
    soundPath('RandomVoice/Random4.mp3'),
    soundPath('RandomVoice/Random5.mp3'),
    soundPath('RandomVoice/Random6.mp3'),
    soundPath('RandomVoice/Random7.mp3'),
    soundPath('RandomVoice/TargetGrid.mp3'),
    soundPath('RandomVoice/TargetGrid2.mp3'),
    soundPath('RandomVoice/TargetGrid3.mp3')
  ];

  const ENEMY_HIT_VOICE_FILES = [
    soundPath('Enemyhit/EnemyHit.mp3'),
    soundPath('Enemyhit/EnemyHit2.mp3'),
    soundPath('Enemyhit/EnemyHit3.mp3'),
    soundPath('Enemyhit/EnemyHit4.mp3'),
    soundPath('Enemyhit/EnemyHit5.mp3')
  ];

  const TANK_HIT_VOICE_FILES = [
    soundPath('TankHit/Tankhit.mp3'),
    soundPath('TankHit/Tankhit1.mp3'),
    soundPath('TankHit/Tankhit2.mp3'),
    soundPath('TankHit/Tankhit3.mp3')
  ];

  const FRIENDLY_HIT_VOICE_FILES = [
    soundPath('FriendlyHit/FriendlyFire.mp3'),
    soundPath('FriendlyHit/FriendlyFire2.mp3'),
    soundPath('FriendlyHit/FriendlyFire3.mp3'),
    soundPath('FriendlyHit/FriendlyFire4.mp3'),
    soundPath('FriendlyHit/FriendlyFire5.mp3')
  ];

  const MISSION_SUCCESS_VOICE_FILES = [
    soundPath('MissionSuccess/MissionSuccess.mp3'),
    soundPath('MissionSuccess/MissionSuccess1.mp3'),
    soundPath('MissionSuccess/MissionSuccess2.mp3'),
    soundPath('MissionSuccess/MissionSuccess3.mp3')
  ];

  const MISSION_FAILURE_VOICE_FILES = [
    soundPath('MissionFailed/MissionFailed.mp3'),
    soundPath('MissionFailed/MissionFailed1.mp3'),
    soundPath('MissionFailed/MissionFailed2.mp3'),
    soundPath('MissionFailed/MissionFailed3.mp3')
  ];

  const MENU_MUSIC_FILES = [
    soundPath('MenuMusic/Broken Net.mp3'),
    soundPath('MenuMusic/Dead Air Relay.mp3'),
    soundPath('MenuMusic/Field Radio Ghosts.mp3')
  ];

  const missionVoicePlayers = new Set();
  let enemyHitVoiceCooldownUntil = 0;
  let friendlyHitVoiceCooldownUntil = 0;

  function readStoredVolume(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;
      const parsed = Number(raw);
      return Number.isFinite(parsed) ? Utils.clamp(parsed, 0, 1) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeStoredVolume(key, value) {
    try {
      localStorage.setItem(key, String(Utils.clamp(value, 0, 1)));
    } catch (_) {}
  }

  function init() {
    if (initialized) return;
    try {
      masterVolume = readStoredVolume(MASTER_VOLUME_STORAGE_KEY, 0.5);
      menuMusicVolume = readStoredVolume(MENU_MUSIC_VOLUME_STORAGE_KEY, 0.45);
      explosionVolume = readStoredVolume(EXPLOSION_VOLUME_STORAGE_KEY, 0.7);
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = masterVolume;
      masterGain.connect(ctx.destination);
      menuMusicGain = ctx.createGain();
      menuMusicGain.gain.value = 0;
      menuMusicGain.connect(masterGain);
      explosionGain = ctx.createGain();
      explosionGain.gain.value = explosionVolume;
      explosionGain.connect(masterGain);
      initialized = true;
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function pickRandomFile(files, lastFile = null) {
    if (!files || !files.length) return null;
    if (files.length === 1) return files[0];
    let next = files[Math.floor(Math.random() * files.length)];
    while (next === lastFile) {
      next = files[Math.floor(Math.random() * files.length)];
    }
    return next;
  }

  // ---- Noise generators ----

  function createNoise(duration, type = 'white') {
    if (!ctx) return null;
    const bufSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    return source;
  }

  function createLoopingNoise(loopDuration = 2) {
    if (!ctx) return null;
    const source = createNoise(loopDuration);
    if (!source) return null;
    source.loop = true;
    return source;
  }

  function createOscillator(freq, type = 'sine', detune = 0) {
    if (!ctx) return null;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    return osc;
  }

  function playNode(node, gainVal, startTime = 0, duration = null) {
    if (!node || !ctx) return;
    const g = ctx.createGain();
    g.gain.value = gainVal;
    node.connect(g);
    g.connect(masterGain);
    const t = ctx.currentTime + startTime;
    node.start(t);
    if (duration !== null) {
      g.gain.setValueAtTime(gainVal, t + duration * 0.7);
      g.gain.linearRampToValueAtTime(0, t + duration);
      node.stop(t + duration + 0.05);
    }
  }

  // ---- Weapon sounds ----

  function playMinigun() {
    resume();
    if (!ctx) return;
    // Short, deep burst shaped to read more like a BRRRRT than a bright snap
    const noise = createNoise(0.09);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 360;
    bpf.Q.value = 1.1;
    noise.connect(bpf);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.95, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.014);
    bpf.connect(g);
    g.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + 0.016);

    const osc = createOscillator(78, 'sawtooth');
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.38, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.012);
    osc.connect(og);
    og.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.014);

    const subOsc = createOscillator(46, 'square');
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.16, ctx.currentTime);
    sg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.016);
    subOsc.connect(sg);
    sg.connect(masterGain);
    subOsc.start();
    subOsc.stop(ctx.currentTime + 0.018);
  }

  function play25mm() {
    resume();
    if (!ctx) return;
    // Short sharp burst
    const noise = createNoise(0.08);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass';
    bpf.frequency.value = 600;
    bpf.Q.value = 1.5;
    noise.connect(bpf);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.8, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
    bpf.connect(g);
    g.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + 0.1);

    // Tone burst
    const osc = createOscillator(120, 'sawtooth');
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.3, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.05);
    osc.connect(og);
    og.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.06);
  }

  function play20mm() {
    resume();
    if (!ctx) return;
    // Higher-pitched, shorter, lighter version of 30mm
    const dur = 0.25 + 0.3 * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 700;      // higher cutoff = brighter/crack-ier than 30mm's 400
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.16, ctx.currentTime);  // quieter than 30mm (0.22)
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
    // Short tonal crack — higher pitch than 30mm
    const osc = createOscillator(220, 'sawtooth');
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.12, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
    osc.connect(og);
    og.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.07);
  }

  function play20mmFire() {
    resume();
    if (!ctx) return;
    // Impact sound but 30% deeper: cutoff 392Hz (560*0.7), osc 123Hz (176*0.7)
    const dur = 0.28 + 0.3 * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 392;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.28, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
    const osc = createOscillator(123, 'sawtooth');
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.18, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.10);
    osc.connect(og);
    og.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.11);
  }

  function play20mmImpact() {
    resume();
    if (!ctx) return;
    // Pure noise explosion — no oscillator tone, just like playExplosion but smaller/sharper
    const dur = 0.35;
    const noise = createNoise(dur);
    // Two-stage filter: highpass to strip rumble, then lowpass to shape the crack
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 40;
    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass';
    lpf.frequency.value = 600;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.55, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(hpf);
    hpf.connect(lpf);
    lpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
  }

  function play30mm() {
    resume();
    if (!ctx) return;
    // Explosion sound — lower volume, deeper cutoff
    const dur = 0.4 + 0.3 * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.44, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
  }

  function playRifle() {
    resume();
    if (!ctx) return;
    // Same synthesis as play30mm: 20% higher pitch (freq ×1.2), 50% quieter (gain ×0.5)
    const dur = 0.4 + 0.3 * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 480;      // 400 * 1.2
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.36, ctx.currentTime);   // clearly audible, still quieter than 30mm (0.22)
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
  }

  function play40mm() {
    resume();
    if (!ctx) return;
    // Explosion sound — lower volume, deeper cutoff
    const dur = 0.4 + 0.6 * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 300;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.56, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
  }

  function playTankFire() {
    resume();
    if (!ctx) return;
    // 40mm-style report, but 20% quieter and deeper for tank cannon bass
    const dur = 0.4 + 0.6 * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 240;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.448, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);

    const subOsc = createOscillator(62, 'sawtooth');
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.085, ctx.currentTime);
    sg.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.16);
    subOsc.connect(sg);
    sg.connect(masterGain);
    subOsc.start();
    subOsc.stop(ctx.currentTime + 0.18);
  }

  function play105mm() {
    resume();
    if (!ctx) return;
    // Longer blast with a delayed low tail to suggest distant echo
    const dur = 0.4 + 2.4 * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(1.5, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.16, ctx.currentTime + dur * 0.72);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur + 0.45);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(masterGain);
    noise.start();

    const echoNoise = createNoise(1.8);
    const echoBpf = ctx.createBiquadFilter();
    echoBpf.type = 'bandpass';
    echoBpf.frequency.value = 120;
    echoBpf.Q.value = 0.7;
    const echoGain = ctx.createGain();
    echoGain.gain.setValueAtTime(0.001, ctx.currentTime);
    echoGain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.34);
    echoGain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.95);
    echoGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.95);
    echoNoise.connect(echoBpf);
    echoBpf.connect(echoGain);
    echoGain.connect(masterGain);
    echoNoise.start(ctx.currentTime + 0.16);

    const echoOsc = createOscillator(78, 'sine');
    const eog = ctx.createGain();
    eog.gain.setValueAtTime(0.001, ctx.currentTime);
    eog.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.22);
    eog.gain.exponentialRampToValueAtTime(0.022, ctx.currentTime + 0.86);
    eog.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.7);
    echoOsc.frequency.setValueAtTime(88, ctx.currentTime);
    echoOsc.frequency.exponentialRampToValueAtTime(42, ctx.currentTime + 1.3);
    echoOsc.connect(eog);
    eog.connect(masterGain);
    echoOsc.start(ctx.currentTime + 0.12);

    noise.stop(ctx.currentTime + dur + 0.55);
    echoNoise.stop(ctx.currentTime + 2.05);
    echoOsc.stop(ctx.currentTime + 1.78);
  }

  function playClusterBombRelease() {
    resume();
    if (!ctx) return;

    const bodyNoise = createNoise(1.7);
    const bodyBpf = ctx.createBiquadFilter();
    bodyBpf.type = 'bandpass';
    bodyBpf.frequency.value = 155;
    bodyBpf.Q.value = 0.75;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.001, ctx.currentTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.07, ctx.currentTime + 0.04);
    bodyGain.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 0.32);
    bodyGain.gain.exponentialRampToValueAtTime(0.0175, ctx.currentTime + 0.82);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.32);
    bodyNoise.connect(bodyBpf);
    bodyBpf.connect(bodyGain);
    bodyGain.connect(masterGain);
    bodyNoise.start();
    bodyNoise.stop(ctx.currentTime + 1.4);

    const hissNoise = createNoise(1.2);
    const hissHpf = ctx.createBiquadFilter();
    hissHpf.type = 'highpass';
    hissHpf.frequency.value = 620;
    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(0.001, ctx.currentTime);
    hissGain.gain.exponentialRampToValueAtTime(0.03, ctx.currentTime + 0.02);
    hissGain.gain.exponentialRampToValueAtTime(0.0225, ctx.currentTime + 0.28);
    hissGain.gain.exponentialRampToValueAtTime(0.009, ctx.currentTime + 0.82);
    hissGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.12);
    hissNoise.connect(hissHpf);
    hissHpf.connect(hissGain);
    hissGain.connect(masterGain);
    hissNoise.start();
    hissNoise.stop(ctx.currentTime + 1.18);

    const osc = createOscillator(128, 'sawtooth');
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.001, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.011, ctx.currentTime + 0.03);
    og.gain.exponentialRampToValueAtTime(0.008, ctx.currentTime + 0.38);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.92);
    osc.frequency.setValueAtTime(155, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(62, ctx.currentTime + 0.74);
    osc.connect(og);
    og.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.96);
  }

  function playMissileLaunch() {
    resume();
    if (!ctx) return;

    const bodyNoise = createNoise(3);
    const bodyBpf = ctx.createBiquadFilter();
    bodyBpf.type = 'bandpass';
    bodyBpf.frequency.value = 150;
    bodyBpf.Q.value = 0.78;
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.001, ctx.currentTime);
    bodyGain.gain.exponentialRampToValueAtTime(0.065, ctx.currentTime + 0.04);
    bodyGain.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 0.34);
    bodyGain.gain.exponentialRampToValueAtTime(0.015, ctx.currentTime + 0.82);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.36);
    bodyNoise.connect(bodyBpf);
    bodyBpf.connect(bodyGain);
    bodyGain.connect(masterGain);
    bodyNoise.start();
    bodyNoise.stop(ctx.currentTime + 1.45);

    const hissNoise = createNoise(4);
    const hissHpf = ctx.createBiquadFilter();
    hissHpf.type = 'highpass';
    hissHpf.frequency.value = 540;
    const hissGain = ctx.createGain();
    hissGain.gain.setValueAtTime(0.001, ctx.currentTime);
    hissGain.gain.exponentialRampToValueAtTime(0.055, ctx.currentTime + 0.018);
    hissGain.gain.exponentialRampToValueAtTime(0.02, ctx.currentTime + 0.28);
    hissGain.gain.exponentialRampToValueAtTime(0.006, ctx.currentTime + 0.72);
    hissGain.gain.exponentialRampToValueAtTime(0.0015, ctx.currentTime + 1.45);
    hissGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 4.0);
    hissNoise.connect(hissHpf);
    hissHpf.connect(hissGain);
    hissGain.connect(masterGain);
    hissNoise.start();
    hissNoise.stop(ctx.currentTime + 4.05);

    const osc = createOscillator(124, 'sawtooth');
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.001, ctx.currentTime);
    og.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.03);
    og.gain.exponentialRampToValueAtTime(0.006, ctx.currentTime + 0.34);
    og.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(58, ctx.currentTime + 0.8);
    osc.connect(og);
    og.connect(masterGain);
    osc.start();
    osc.stop(ctx.currentTime + 0.96);
  }

  function playMissileLockBeep(mode = 'acquiring') {
    resume();
    if (!ctx) return;

    const t = ctx.currentTime;
    const freq = mode === 'locked' ? 1380 : 980;
    const duration = mode === 'locked' ? 0.06 : 0.09;
    const osc = createOscillator(freq, 'square');
    const og = ctx.createGain();
    og.gain.setValueAtTime(mode === 'locked' ? 0.06 : 0.045, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(og);
    og.connect(masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  function setMissileLockTone(mode = 'off') {
    if (missileLockMode === mode) return;
    if (missileLockInterval) {
      clearInterval(missileLockInterval);
      missileLockInterval = null;
    }
    missileLockMode = mode;
    if (mode === 'off') return;

    playMissileLockBeep(mode);
    const intervalMs = mode === 'locked' ? 120 : 260;
    missileLockInterval = setInterval(() => {
      playMissileLockBeep(mode);
    }, intervalMs);
  }

  function playExplosion(size = 1.0) {
    resume();
    if (!ctx) return;
    const dur = 0.4 + size * 0.6;
    const noise = createNoise(dur);
    const bpf = ctx.createBiquadFilter();
    bpf.type = 'lowpass';
    bpf.frequency.value = 800;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(size * 0.8, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(bpf);
    bpf.connect(ng);
    ng.connect(explosionGain || masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
  }

  function playRadioChatter(text) {
    resume();
    if (!ctx) return;

    // Radio static only
    const wordCount = text.split(' ').length;
    const dur = 0.5 + wordCount * 0.15;
    const noise = createNoise(dur);
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.frequency.value = 1200;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.07, ctx.currentTime);
    ng.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    noise.connect(hpf);
    hpf.connect(ng);
    ng.connect(masterGain);
    noise.start();
    noise.stop(ctx.currentTime + dur + 0.05);
  }

  function playAmbient() {
    resume();
    if (!ctx) return;
    // Engine drone loop
    const osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc1.frequency.value = 55;
    const osc2 = ctx.createOscillator();
    osc2.type = 'sine';
    osc2.frequency.value = 58;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 3;
    lfo.connect(lfoGain);
    lfoGain.connect(osc1.frequency);

    const g1 = ctx.createGain();
    g1.gain.value = 0.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.007;

    osc1.connect(g1);
    osc2.connect(g2);
    g1.connect(masterGain);
    g2.connect(masterGain);

    osc1.start();
    osc2.start();
    lfo.start();

    return () => {
      osc1.stop(); osc2.stop(); lfo.stop();
    };
  }

  function normalizeVoiceKey(value) {
    return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  function createDistortionCurve(amount = 0) {
    const samples = 44100;
    const curve = new Float32Array(samples);
    const k = Math.max(0, amount);
    const deg = Math.PI / 180;
    for (let i = 0; i < samples; i++) {
      const x = i * 2 / samples - 1;
      curve[i] = k > 0
        ? ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x))
        : x;
    }
    return curve;
  }

  function resolveMissionStartVoice(def) {
    if (!def) return null;

    const candidates = [def.startVoice, def.id, def.name, def.tag];
    for (const candidate of candidates) {
      const key = normalizeVoiceKey(candidate);
      if (key && START_VOICE_ALIASES[key]) return START_VOICE_ALIASES[key];
    }

    return null;
  }

  function stopMissionVoicePlayback() {
    missionVoicePlayers.forEach(player => player.stop());
    missionVoicePlayers.clear();
    activeMissionVoiceCount = 0;
  }

  function pauseMissionVoicePlayback() {
    missionVoicePlayers.forEach(player => {
      if (player && player.pause) player.pause();
    });
  }

  function resumeMissionVoicePlayback() {
    missionVoicePlayers.forEach(player => {
      if (player && player.resume) player.resume();
    });
  }

  function hasActiveMissionVoice() {
    return activeMissionVoiceCount > 0;
  }

  function playVoiceGroup(files, options = {}) {
    if (!files.length) {
      if (typeof options.onEnded === 'function') options.onEnded();
      return null;
    }

    if (options.interruptActive && hasActiveMissionVoice()) stopMissionVoicePlayback();
    if (hasActiveMissionVoice()) return null;

    const src = pickRandomFile(files, options.lastFile || null);
    return playVoiceFile(src, options);
  }

  function playEnemyHitVoice() {
    const now = performance.now() * 0.001;
    if (now < enemyHitVoiceCooldownUntil || hasActiveMissionVoice()) return null;

    const player = playVoiceGroup(ENEMY_HIT_VOICE_FILES, {
      speakerPortrait: SPEAKER_PORTRAITS.radioOperator,
      volume: 0.52,
      staticAmount: 1.15,
      distortionAmount: 15,
      lowpass: 2300,
      highpass: 380
    });

    if (player) enemyHitVoiceCooldownUntil = now + 10 + Math.random() * 5;
    return player;
  }

  function playFriendlyHitVoice() {
    const now = performance.now() * 0.001;
    if (now < friendlyHitVoiceCooldownUntil || hasActiveMissionVoice()) return null;

    const player = playVoiceGroup(FRIENDLY_HIT_VOICE_FILES, {
      speakerPortrait: SPEAKER_PORTRAITS.radioOperator,
      volume: 0.56,
      staticAmount: 1.1,
      distortionAmount: 16,
      lowpass: 2200,
      highpass: 360
    });

    if (player) friendlyHitVoiceCooldownUntil = now + 10 + Math.random() * 5;
    return player;
  }

  function playTankHitVoice() {
    return playVoiceGroup(TANK_HIT_VOICE_FILES, {
      speakerPortrait: SPEAKER_PORTRAITS.radioOperator,
      volume: 0.56,
      staticAmount: 1.0,
      distortionAmount: 14,
      lowpass: 2350,
      highpass: 320
    });
  }

  function playMissionSuccessVoice() {
    return playVoiceGroup(MISSION_SUCCESS_VOICE_FILES, {
      interruptActive: true,
      speakerPortrait: SPEAKER_PORTRAITS.radioOperator,
      volume: 0.62,
      staticAmount: 0.95,
      distortionAmount: 10,
      lowpass: 2800,
      highpass: 240
    });
  }

  function playMissionFailureVoice() {
    return playVoiceGroup(MISSION_FAILURE_VOICE_FILES, {
      interruptActive: true,
      speakerPortrait: SPEAKER_PORTRAITS.radioOperator,
      volume: 0.62,
      staticAmount: 1.1,
      distortionAmount: 16,
      lowpass: 2500,
      highpass: 260
    });
  }

  function playVoiceFile(src, options = {}) {
    resume();
    if (!ctx || !src) return null;

    const {
      speakerPortrait = SPEAKER_PORTRAITS.radioOperator,
      volume = 1,
      staticAmount = 0,
      distortionAmount = 0,
      lowpass = 2400,
      highpass = 240,
      onEnded = null
    } = options;

    const audio = new Audio(encodeURI(src));
    audio.preload = 'auto';

    const source = ctx.createMediaElementSource(audio);
    const inputGain = ctx.createGain();
    const toneHighpass = ctx.createBiquadFilter();
    const toneLowpass = ctx.createBiquadFilter();
    const distortion = distortionAmount > 0 ? ctx.createWaveShaper() : null;
    const voiceGain = ctx.createGain();

    toneHighpass.type = 'highpass';
    toneHighpass.frequency.value = highpass;
    toneLowpass.type = 'lowpass';
    toneLowpass.frequency.value = lowpass;
    if (distortion) {
      distortion.curve = createDistortionCurve(distortionAmount);
      distortion.oversample = '4x';
    }
    voiceGain.gain.value = volume;

    source.connect(inputGain);
    inputGain.connect(toneHighpass);
    toneHighpass.connect(toneLowpass);
    if (distortion) {
      toneLowpass.connect(distortion);
      distortion.connect(voiceGain);
    } else {
      toneLowpass.connect(voiceGain);
    }
    voiceGain.connect(masterGain);

    let staticNoise = null;
    let staticHighpass = null;
    let staticGain = null;
    let paused = false;

    function stopStaticNoise() {
      if (!staticNoise) return;
      try { staticNoise.stop(); } catch (_) {}
      staticNoise.disconnect();
      staticNoise = null;
    }

    function startStaticNoise() {
      if (staticAmount <= 0 || !staticHighpass) return;
      stopStaticNoise();
      staticNoise = createLoopingNoise(2.5);
      if (!staticNoise) return;
      staticNoise.connect(staticHighpass);
      staticNoise.start();
    }

    if (staticAmount > 0) {
      staticHighpass = ctx.createBiquadFilter();
      staticGain = ctx.createGain();
      staticHighpass.type = 'highpass';
      staticHighpass.frequency.value = 1600;
      staticGain.gain.value = 0.018 * staticAmount;
      staticHighpass.connect(staticGain);
      staticGain.connect(masterGain);
    }

    let cleanedUp = false;
    activeMissionVoiceCount++;

    const player = {
      stop: cleanup,
      pause() {
        if (cleanedUp || paused) return;
        paused = true;
        try { audio.pause(); } catch (_) {}
        stopStaticNoise();
      },
      resume() {
        if (cleanedUp || !paused) return;
        paused = false;
        startStaticNoise();
        audio.play().catch(() => cleanup());
      }
    };

    function cleanup() {
      if (cleanedUp) return;
      cleanedUp = true;
      missionVoicePlayers.delete(player);
      activeMissionVoiceCount = Math.max(0, activeMissionVoiceCount - 1);
      if (typeof HUDSystem !== 'undefined' && HUDSystem.hideSpeakerPortrait) {
        HUDSystem.hideSpeakerPortrait();
      }
      try { audio.pause(); } catch (_) {}
      try { audio.currentTime = 0; } catch (_) {}
      audio.onended = null;
      audio.onerror = null;
      source.disconnect();
      inputGain.disconnect();
      toneHighpass.disconnect();
      toneLowpass.disconnect();
      if (distortion) distortion.disconnect();
      voiceGain.disconnect();
      stopStaticNoise();
      if (staticHighpass) staticHighpass.disconnect();
      if (staticGain) staticGain.disconnect();
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch (_) {}
      if (typeof onEnded === 'function') onEnded();
    }

    missionVoicePlayers.add(player);
    audio.onended = cleanup;
    audio.onerror = cleanup;

    startStaticNoise();
    if (typeof HUDSystem !== 'undefined' && HUDSystem.showSpeakerPortrait) {
      HUDSystem.showSpeakerPortrait(speakerPortrait);
    }
    audio.play().catch(() => cleanup());

    return player;
  }

  function playMissionStartVoice(def) {
    const src = resolveMissionStartVoice(def);
    if (!src) return null;
    stopMissionVoicePlayback();
    return playVoiceFile(src, {
      speakerPortrait: SPEAKER_PORTRAITS.general,
      volume: 1,
      staticAmount: 0.35,
      lowpass: 3000,
      highpass: 180
    });
  }

  function playRandomMissionVoice(onEnded = null) {
    if (!RANDOM_VOICE_FILES.length) {
      if (typeof onEnded === 'function') onEnded();
      return null;
    }

    return playVoiceGroup(RANDOM_VOICE_FILES, {
      speakerPortrait: SPEAKER_PORTRAITS.soldier,
      volume: 0.5,
      staticAmount: 1.4,
      distortionAmount: 18,
      lowpass: 2200,
      highpass: 420,
      onEnded
    });
  }

  function ensureMenuMusicPlayer() {
    if (!ctx || !menuMusicGain) return false;
    if (!menuMusicAudio) {
      menuMusicAudio = new Audio();
      menuMusicAudio.preload = 'auto';
      menuMusicAudio.loop = false;
      menuMusicAudio.addEventListener('ended', () => {
        if (menuMusicEnabled) playRandomMenuMusic();
      });
      menuMusicAudio.addEventListener('error', () => {
        if (menuMusicEnabled) playRandomMenuMusic();
      });
    }
    if (!menuMusicSource) {
      menuMusicSource = ctx.createMediaElementSource(menuMusicAudio);
      menuMusicSource.connect(menuMusicGain);
    }
    return true;
  }

  function clearMenuMusicStopTimer() {
    if (!menuMusicStopTimer) return;
    clearTimeout(menuMusicStopTimer);
    menuMusicStopTimer = null;
  }

  function rampMenuMusicIn() {
    if (!ctx || !menuMusicGain) return;
    const now = ctx.currentTime;
    menuMusicGain.gain.cancelScheduledValues(now);
    menuMusicGain.gain.setValueAtTime(0, now);
    menuMusicGain.gain.linearRampToValueAtTime(0, now + 1.8);
    menuMusicGain.gain.linearRampToValueAtTime(menuMusicVolume, now + 5.0);
  }

  function playRandomMenuMusic() {
    resume();
    if (!menuMusicEnabled || !MENU_MUSIC_FILES.length || !ensureMenuMusicPlayer()) return;

    const src = pickRandomFile(MENU_MUSIC_FILES, lastMenuMusicTrack);
    if (!src) return;
    lastMenuMusicTrack = src;
    clearMenuMusicStopTimer();
    menuMusicAudio.src = encodeURI(src);
    menuMusicAudio.currentTime = 0;
    rampMenuMusicIn();
    menuMusicAudio.play().catch(() => {});
  }

  function enableMenuMusic() {
    if (menuMusicEnabled && menuMusicAudio && !menuMusicAudio.paused) return;
    menuMusicEnabled = true;
    playRandomMenuMusic();
  }

  function disableMenuMusic() {
    menuMusicEnabled = false;
    if (!ctx || !menuMusicGain || !menuMusicAudio) return;
    clearMenuMusicStopTimer();
    const now = ctx.currentTime;
    menuMusicGain.gain.cancelScheduledValues(now);
    menuMusicGain.gain.setValueAtTime(menuMusicGain.gain.value, now);
    menuMusicGain.gain.linearRampToValueAtTime(0, now + 0.35);
    menuMusicStopTimer = setTimeout(() => {
      if (menuMusicAudio && !menuMusicEnabled) {
        menuMusicAudio.pause();
        menuMusicAudio.currentTime = 0;
      }
      menuMusicStopTimer = null;
    }, 360);
  }

  function setVolume(v) {
    masterVolume = Utils.clamp(v, 0, 1);
    if (masterGain) masterGain.gain.value = masterVolume;
    writeStoredVolume(MASTER_VOLUME_STORAGE_KEY, masterVolume);
  }

  function getVolume() {
    return masterVolume;
  }

  function setMenuMusicVolume(v) {
    menuMusicVolume = Utils.clamp(v, 0, 1);
    writeStoredVolume(MENU_MUSIC_VOLUME_STORAGE_KEY, menuMusicVolume);
    if (!ctx || !menuMusicGain) return;
    const now = ctx.currentTime;
    menuMusicGain.gain.cancelScheduledValues(now);
    menuMusicGain.gain.setValueAtTime(menuMusicEnabled ? menuMusicVolume : 0, now);
  }

  function getMenuMusicVolume() {
    return menuMusicVolume;
  }

  function setExplosionVolume(v) {
    explosionVolume = Utils.clamp(v, 0, 1);
    writeStoredVolume(EXPLOSION_VOLUME_STORAGE_KEY, explosionVolume);
    if (explosionGain) explosionGain.gain.value = explosionVolume;
  }

  function getExplosionVolume() {
    return explosionVolume;
  }

  return {
    init, resume,
    playMinigun, play25mm, play20mm, play20mmFire, play20mmImpact, play30mm, play40mm, playTankFire, play105mm, playRifle,
    playClusterBombRelease, playMissileLaunch, setMissileLockTone,
    playExplosion, playRadioChatter, playAmbient,
    playMissionStartVoice, playRandomMissionVoice,
    playEnemyHitVoice, playFriendlyHitVoice, playTankHitVoice, playMissionSuccessVoice, playMissionFailureVoice,
    stopMissionVoicePlayback, pauseMissionVoicePlayback, resumeMissionVoicePlayback, hasActiveMissionVoice,
    enableMenuMusic, disableMenuMusic, setMenuMusicVolume, getMenuMusicVolume, setExplosionVolume, getExplosionVolume,
    setVolume, getVolume
  };
})();
