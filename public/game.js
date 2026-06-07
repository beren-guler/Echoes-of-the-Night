/**
 * Echoes of the Night — Game Engine
 *
 * Phase:  intro → playing → gameover | win
 * Room:   idle | monster_wardrobe | flashlight_on | parents | bed_monster | bed_monster_pillow
 *
 * Event queue (tek kuyruk, 1/3 ihtimalle her biri):
 *   - Dolap canavarı (görsel) → fener
 *   - Yatak canavarı (görsel) → yastık
 *   - Ses olayı: canavar sesi → yastık  |  ebeveyn tuzağı → tepki verme
 *
 * Controls:
 *   W / ↑     Basılı tut — müzik kutusu ses artır
 *   F         Tek tuş   — fener (1 s sonra kapanır)
 *   Space     Tek tuş   — yastığa vur
 *   M / B / P Debug: dolap / yatak / ses olayı
 */

'use strict';

// ════════════════════════════════════════════════════════════
//  ASSET PATHS
// ════════════════════════════════════════════════════════════
const ASSETS = {
  images: {
    idle       : 'images/room_idle.jpg',
    monster    : 'images/room_wardrobe_monster.png',
    flashlight : 'images/room_flashlight.png',
    parents    : 'images/room_parents.png',
    bedMonster : 'images/room_monster_under_bed_nopillow.png',
    bedPillow  : 'images/room_monster_under_bed_pillow.png',
  },
  audio: {
    // isimde "monster" var → canavar sesi → yastıkla tepki vermeli
    monster     : ['audio/monster_sound_sound.m4a', 'audio/monster_soundbagvoice.m4a', 'audio/monster_sound_hiss.m4a'],
    monsterSteps: ['audio/footsteps_monster.m4a'],
    // isimde "parent" var → ebeveyn tuzağı → tepki verilmemeli
    parentDecoy : ['audio/footsteps_parents.m4a', 'audio/parents_mouth_voice.m4a', 'audio/parents_voice_hiss.m4a'],
    // anne / baba sahnesi sesleri — replika bitene kadar sahne bitmez
    motherVisit : ['audio/mother_sound_1.m4a','audio/mother_sound_2.m4a','audio/mother_sound_3.m4a','audio/mother_sound_4.m4a','audio/mother_sound_5.m4a'],
    fatherVisit : ['audio/father_sound_1.m4a','audio/father_sound_2.m4a','audio/father_sound_3.m4a','audio/father_sound_4.m4a','audio/father_sound_5.m4a'],
  }
};

const BG_MUSIC_SRC = 'audio/horror-music-box_sound.mp3';

// ════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════
const C = Object.freeze({
  TICK_MS          : 200,
  SANITY_DECAY     : 0.12,
  SANITY_REGEN     : 6,
  SANITY_THRESHOLD : 20,
  SANITY_DRAIN_KEY : 3,

  MONSTER_SPAWN_MIN: 1000,
  MONSTER_SPAWN_MAX: 15000,
  MONSTER_TIMEOUT  : 5000,

  FLASHLIGHT_DURATION: 1000,
  FLASHLIGHT_COOLDOWN: 1200,
  FLASHLIGHT_LUX     : 500,

  WIN_SECONDS: 180,
});

// ════════════════════════════════════════════════════════════
//  GAME STATE
// ════════════════════════════════════════════════════════════
let G = {
  phase       : 'intro',
  roomState   : 'idle',
  health      : 3,
  sanity      : 78,

  wardrobeMonster   : false,
  bedMonster        : false,
  attacked          : false,
  falsePositiveCount: 0,

  // Ses-only olay: { type:'monster'|'parent', audio:Audio }
  soundEvent      : null,
  _soundEventTimer: null,

  keyUp         : false,
  keyDown       : false,
  flashOn       : false,
  flashCooldown : false,
  parentVisiting: false,   // anne/baba sahnesi boyunca tüm tuşlar kilitli

  arduinoConnected: false,
  survivalSec     : 0,

  _loop      : null,
  _clock     : null,
  _eventSpawn: null,
  _wAttack   : null,
  _bAttack   : null,
  _wRepel    : null,
  _mtInt     : null,
};

// ════════════════════════════════════════════════════════════
//  AUDIO SYSTEM
// ════════════════════════════════════════════════════════════
const sfxPools = {};   // category → Audio[]
let bgMusic = null;
let lastPot  = null;   // potansiyometre delta takibi

function initAudio() {
  Object.entries(ASSETS.audio).forEach(([key, paths]) => {
    sfxPools[key] = paths.map(src => {
      try { const a = new Audio(src); a.preload = 'auto'; return a; }
      catch (_) { return null; }
    }).filter(Boolean);
  });

  try {
    bgMusic = new Audio(BG_MUSIC_SRC);
    bgMusic.loop    = true;
    bgMusic.volume  = 0.5;
    bgMusic.preload = 'auto';
  } catch (_) {}
}

// Kategoriden rastgele bir ses çalar, Audio nesnesini döndürür (yoksa null)
function playRandom(category) {
  const pool = sfxPools[category];
  if (!pool || !pool.length) return null;
  const a = pool[Math.floor(Math.random() * pool.length)];
  a.currentTime = 0;
  a.play().catch(() => {});
  return a;
}

// Aktif ses olayını iptal eder
function clearActiveSoundEvent() {
  if (!G.soundEvent) return;
  clearTimeout(G._soundEventTimer);
  try { G.soundEvent.audio.pause(); G.soundEvent.audio.currentTime = 0; } catch (_) {}
  G.soundEvent = null;
}

function startBgMusic() {
  if (bgMusic) bgMusic.play().catch(() => {});
}

function stopBgMusic() {
  if (!bgMusic) return;
  bgMusic.pause();
  bgMusic.currentTime = 0;
}

// Sanity düştükçe müzik kutusu sesi belirgin şekilde azalır (quadratic eğri)
function updateBgMusicVolume() {
  if (!bgMusic) return;
  const t = G.sanity / 100;
  bgMusic.volume = Math.max(0.02, t * t * 0.7);
}

// ════════════════════════════════════════════════════════════
//  DOM CACHE
// ════════════════════════════════════════════════════════════
let D = {};

function cacheDOM() {
  D.screens = {
    intro   : document.getElementById('screen-intro'),
    game    : document.getElementById('screen-game'),
    gameover: document.getElementById('screen-gameover'),
  };
  D.rooms = {
    idle              : document.getElementById('room-idle'),
    monster_wardrobe  : document.getElementById('room-monster'),
    flashlight_on     : document.getElementById('room-flashlight'),
    parents           : document.getElementById('room-parents'),
    bed_monster       : document.getElementById('room-bed-monster'),
    bed_monster_pillow: document.getElementById('room-bed-pillow'),
  };

  D.rooms.idle.src               = ASSETS.images.idle;
  D.rooms.monster_wardrobe.src   = ASSETS.images.monster;
  D.rooms.flashlight_on.src      = ASSETS.images.flashlight;
  D.rooms.parents.src            = ASSETS.images.parents;
  D.rooms.bed_monster.src        = ASSETS.images.bedMonster;
  D.rooms.bed_monster_pillow.src = ASSETS.images.bedPillow;

  const introBg = document.querySelector('.intro-bg');
  if (introBg) introBg.style.backgroundImage = `url('${ASSETS.images.idle}')`;

  D.sanityFill = document.getElementById('sanity-fill');
  D.sanityPct  = document.getElementById('sanity-pct');
  D.hearts     = document.querySelectorAll('.heart-icon');
  D.warning    = document.getElementById('warning-msg');
  D.flash      = document.getElementById('attack-flash');
  D.timer      = document.getElementById('survival-timer');
  D.goTitle    = document.getElementById('go-title');
  D.goMsg      = document.getElementById('go-msg');
  D.arduinoTag = document.getElementById('arduino-tag');
  D.simHint    = document.getElementById('sim-hint');
  D.flashBtn   = document.getElementById('btn-flashlight');
  D.pillowBtn  = document.getElementById('btn-pillow');
  D.volUp      = document.getElementById('btn-vol-up');
  D.volDown    = document.getElementById('btn-vol-down');

  D.monsterTimer = document.getElementById('monster-timer');
  D.mtCount      = document.getElementById('mt-count');
  D.mtArc        = document.getElementById('mt-arc');
}

// ════════════════════════════════════════════════════════════
//  MONSTER COUNTDOWN TIMER (sadece görsel canavarlar)
// ════════════════════════════════════════════════════════════
const MT_CIRC = 2 * Math.PI * 20; // r=20 → 125.66

function showMonsterTimer(totalSec) {
  if (!D.monsterTimer) return;
  clearInterval(G._mtInt);
  let remaining = totalSec;
  _updateMtUI(remaining, totalSec);
  D.monsterTimer.classList.remove('hidden');

  G._mtInt = setInterval(() => {
    remaining = Math.max(0, remaining - 0.1);
    _updateMtUI(remaining, totalSec);
    if (remaining <= 0) clearInterval(G._mtInt);
  }, 100);
}

function _updateMtUI(remaining, total) {
  const pct = remaining / total;
  if (D.mtCount) D.mtCount.textContent          = Math.ceil(remaining);
  if (D.mtArc)   D.mtArc.style.strokeDashoffset = MT_CIRC * (1 - pct);
  D.monsterTimer?.classList.toggle('urgent', remaining <= 4 && remaining > 0);
}

function hideMonsterTimer() {
  clearInterval(G._mtInt);
  D.monsterTimer?.classList.add('hidden');
}

// ════════════════════════════════════════════════════════════
//  SCREEN MANAGEMENT
// ════════════════════════════════════════════════════════════
function showScreen(name) {
  Object.values(D.screens).forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });
  D.screens[name].classList.remove('hidden');
  requestAnimationFrame(() => D.screens[name].classList.add('active'));
}

// ════════════════════════════════════════════════════════════
//  ROOM IMAGE TRANSITIONS
// ════════════════════════════════════════════════════════════
function setRoom(state) {
  if (G.roomState === state) return;
  const prev = D.rooms[G.roomState];
  const next = D.rooms[state];
  if (!prev || !next) return;
  G.roomState = state;              // mantıksal durum hemen güncellenir
  prev.classList.add('fade-out');
  setTimeout(() => {
    prev.classList.remove('active', 'fade-out');
    next.classList.add('active');
  }, 350);
}

// ════════════════════════════════════════════════════════════
//  GAME START / RESET
// ════════════════════════════════════════════════════════════
function startGame() {
  stopAllTimers();
  hideMonsterTimer();
  clearActiveSoundEvent();
  stopBgMusic();

  G.phase              = 'playing';
  G.roomState          = 'idle';
  G.health             = 3;
  G.sanity             = 78;
  G.wardrobeMonster    = false;
  G.bedMonster         = false;
  G.attacked           = false;
  G.falsePositiveCount = 0;
  G.survivalSec        = 0;
  G.flashOn            = false;
  G.flashCooldown      = false;
  G.parentVisiting     = false;
  lastPot              = null;   // bağlantı sıfırlanınca pot geçmişi temizlenir

  Object.values(D.rooms).forEach(r => r.classList.remove('active', 'fade-out'));
  D.rooms.idle.classList.add('active');
  document.getElementById('screen-game').classList.remove('bed-glow');

  updateHealthUI();
  updateSanityBar();
  setWarning('');
  updateTimer();

  showScreen('game');
  startBgMusic();

  G._loop  = setInterval(gameTick, C.TICK_MS);
  G._clock = setInterval(clockTick, 1000);
  scheduleNextEvent();
}

function stopAllTimers() {
  [G._loop, G._clock, G._eventSpawn, G._wAttack, G._bAttack, G._wRepel, G._mtInt, G._soundEventTimer]
    .forEach(t => { if (t) { clearTimeout(t); clearInterval(t); } });
}

// ════════════════════════════════════════════════════════════
//  GAME LOOP (her TICK_MS'de bir)
// ════════════════════════════════════════════════════════════
function gameTick() {
  if (G.phase !== 'playing') return;

  // G.keyUp klavyeden (W/↑) veya Arduino pot deltasından gelir — her ikisi de aynı logiği kullanır
  if (G.keyUp) {
    G.sanity = Math.min(100, G.sanity + C.SANITY_REGEN);
  } else {
    const extra = G.keyDown ? C.SANITY_DRAIN_KEY : 0;
    G.sanity = Math.max(0, G.sanity - C.SANITY_DECAY - extra);
  }

  updateSanityBar();

  if (G.sanity < C.SANITY_THRESHOLD && (G.wardrobeMonster || G.bedMonster)) {
    monsterAttack('sanity');
  }
}

function clockTick() {
  if (G.phase !== 'playing') return;
  G.survivalSec++;
  updateTimer();
  if (G.survivalSec >= C.WIN_SECONDS) triggerWin();
}

// ════════════════════════════════════════════════════════════
//  EVENT QUEUE — tek kuyruk: görsel veya ses olayı
// ════════════════════════════════════════════════════════════
function scheduleNextEvent() {
  clearTimeout(G._eventSpawn);
  if (G.parentVisiting) return;   // anne/baba sahnesi bitince kendi schedule'lar
  const d = C.MONSTER_SPAWN_MIN + Math.random() * (C.MONSTER_SPAWN_MAX - C.MONSTER_SPAWN_MIN);
  G._eventSpawn = setTimeout(() => {
    const r = Math.random();
    if      (r < 0.34) spawnWardrobeMonster();
    else if (r < 0.67) spawnBedMonster();
    else               spawnSoundEvent();
  }, d);
}

// ── Ses-only Olay ───────────────────────────────────────────
function spawnSoundEvent() {
  if (G.phase !== 'playing' || G.wardrobeMonster || G.bedMonster || G.parentVisiting) {
    scheduleNextEvent();
    return;
  }

  const isMonster = Math.random() < 0.5;
  const audio = playRandom(isMonster ? 'monster' : 'parentDecoy');
  if (!audio) { scheduleNextEvent(); return; }

  G.soundEvent = { type: isMonster ? 'monster' : 'parent', audio };

  if (isMonster) {
    let handled = false;
    const onMiss = () => {
      if (handled) return;
      handled = true;
      if (G.soundEvent?.type === 'monster') {
        G.soundEvent = null;
        falsePositive();
      }
    };
    audio.addEventListener('ended', onMiss, { once: true });
    G._soundEventTimer = setTimeout(onMiss, 8000);

  } else {
    // Ebeveyn tuzağı — hiçbir uyarı verilmez, tepki verilmemeli
    let handled = false;
    const onDone = () => {
      if (handled) return;
      handled = true;
      if (G.soundEvent?.type === 'parent') {
        G.soundEvent = null;
        scheduleNextEvent();
      }
    };
    audio.addEventListener('ended', onDone, { once: true });
    G._soundEventTimer = setTimeout(onDone, 8000);
  }
}

// ── Görsel: Dolap Canavarı ──────────────────────────────────
function spawnWardrobeMonster() {
  if (G.phase !== 'playing' || G.wardrobeMonster || G.parentVisiting) return;
  G.wardrobeMonster = true;
  setRoom('monster_wardrobe');
  setWarning('👁  SOMETHING IS IN THE WARDROBE — SHINE YOUR FLASHLIGHT!');
  showMonsterTimer(C.MONSTER_TIMEOUT / 1000);

  G._wAttack = setTimeout(() => {
    if (G.wardrobeMonster) monsterAttack('wardrobe_timeout');
  }, C.MONSTER_TIMEOUT);
}

function repelWardrobeMonster() {
  if (!G.wardrobeMonster) return;
  G.wardrobeMonster = false;
  clearTimeout(G._wAttack);
  hideMonsterTimer();
  setRoom('idle');
  setWarning('✓  Monster driven back!', 1800);
  scheduleNextEvent();
}

// ── Görsel: Yatak Altı Canavarı ─────────────────────────────
function spawnBedMonster() {
  if (G.phase !== 'playing' || G.bedMonster || G.parentVisiting) return;
  G.bedMonster = true;
  document.getElementById('screen-game').classList.add('bed-glow');
  setRoom('bed_monster');
  setWarning('💀  SOMETHING UNDER THE BED — HIT THE PILLOW!');
  showMonsterTimer(C.MONSTER_TIMEOUT / 1000);

  G._bAttack = setTimeout(() => {
    if (G.bedMonster) monsterAttack('bed_timeout');
  }, C.MONSTER_TIMEOUT);
}

function repelBedMonster() {
  if (!G.bedMonster) return;
  G.bedMonster = false;
  clearTimeout(G._bAttack);
  hideMonsterTimer();
  document.getElementById('screen-game').classList.remove('bed-glow');
  setRoom('bed_monster_pillow');
  setWarning('✓  Under-bed monster scared away!', 1800);
  setTimeout(() => { if (G.phase === 'playing') setRoom('idle'); }, 700);
  scheduleNextEvent();
}

// ════════════════════════════════════════════════════════════
//  PLAYER ACTIONS
// ════════════════════════════════════════════════════════════

// ── Fener — tek tuş, 1 s sonra kapanır ─────────────────────
function flashlightActivate() {
  if (G.phase !== 'playing' || G.flashCooldown || G.parentVisiting) return;
  G.flashOn       = true;
  G.flashCooldown = true;

  if (G.wardrobeMonster) {
    // Doğru tepki: dolap canavarına fener
    clearTimeout(G._wAttack);
    setRoom('flashlight_on');
    setWarning('💡  FLASHLIGHT ON!');
    G._wRepel = setTimeout(() => {
      G.flashOn = false;
      if (G.wardrobeMonster) repelWardrobeMonster();
      setTimeout(() => { G.flashCooldown = false; }, 200);
    }, C.FLASHLIGHT_DURATION);

  } else if (G.soundEvent) {
    // Ses olayı sırasında fener: her zaman yanlış
    // (canavar sesi → yastık gerekirdi; ebeveyn sesi → tepki olmamalıydı)
    G.flashOn = false;
    setTimeout(() => { G.flashCooldown = false; }, C.FLASHLIGHT_COOLDOWN);
    clearActiveSoundEvent();
    falsePositive();

  } else {
    // Olay yokken fener → yanlış alarm
    G.flashOn = false;
    setTimeout(() => { G.flashCooldown = false; }, C.FLASHLIGHT_COOLDOWN);
    falsePositive();
  }
}

// ── Yastık — tek tuş ────────────────────────────────────────
function pillowHit() {
  if (G.phase !== 'playing' || G.parentVisiting) return;

  if (G.bedMonster) {
    // Doğru tepki: yatak canavarına yastık
    repelBedMonster();

  } else if (G.soundEvent?.type === 'monster') {
    // Doğru tepki: canavar sesine yastık
    clearActiveSoundEvent();
    setWarning('✓  You drove it away!', 1800);
    scheduleNextEvent();

  } else if (G.soundEvent?.type === 'parent') {
    // Yanlış tepki: ebeveyn sesine yastık vurdun
    clearActiveSoundEvent();
    falsePositive();

  } else {
    // Olay yokken yastık → yanlış alarm
    falsePositive();
  }
}

// ── Yanlış Tepki / Ebeveyn Sistemi ──────────────────────────
function falsePositive() {
  G.falsePositiveCount++;
  if (G.falsePositiveCount === 1) showParent('mother');
  else                             showParent('father');
}

function showParent(who) {
  G.parentVisiting = true;
  setRoom('parents');

  if (who === 'mother') {
    const audio = playRandom('motherVisit');
    setWarning('🚪  YOUR MOTHER IS HERE. Settle down — first warning!');

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      if (G.phase === 'playing') {
        setRoom('idle');
        setWarning('');
        G.parentVisiting = false;
        scheduleNextEvent();   // sahne bitti, yeni olayı planla
      }
    };
    if (audio) {
      audio.addEventListener('ended', finish, { once: true });
      setTimeout(finish, 8000);   // fallback: ses yüklenememişse max bekleme
    } else {
      setTimeout(finish, 3500);
    }

  } else {
    // Baba → oyun bitti
    const audio = playRandom('fatherVisit');
    setWarning('🚪  YOUR FATHER ARRIVED. There is no escape now...');
    G.health = 0;
    updateHealthUI();

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      triggerGameOver();
    };
    if (audio) {
      audio.addEventListener('ended', finish, { once: true });
      setTimeout(finish, 10000);
    } else {
      setTimeout(finish, 2200);
    }
  }
}

// ════════════════════════════════════════════════════════════
//  MONSTER ATTACK
// ════════════════════════════════════════════════════════════
function monsterAttack(reason) {
  if (G.attacked || G.phase !== 'playing') return;
  G.attacked = true;

  G.health = Math.max(0, G.health - 1);
  updateHealthUI();
  triggerFlash();
  hideMonsterTimer();
  clearActiveSoundEvent();

  G.flashOn       = false;
  G.flashCooldown = false;

  const msgs = {
    sanity          : '🩸  THE MUSIC STOPPED... IT CAME FOR YOU!',
    wardrobe_timeout: '🩸  YOU LOOKED AWAY TOO LONG!',
    bed_timeout     : '🩸  IT GRABBED YOU FROM BELOW!',
  };
  setWarning(msgs[reason] || '🩸  MONSTER ATTACK!');

  if (G.wardrobeMonster) { G.wardrobeMonster = false; clearTimeout(G._wAttack); }
  if (G.bedMonster)      { G.bedMonster = false;      clearTimeout(G._bAttack); }
  document.getElementById('screen-game').classList.remove('bed-glow');
  setRoom('idle');

  setTimeout(() => {
    G.attacked = false;
    if (G.phase === 'playing') { setWarning(''); scheduleNextEvent(); }
  }, 2500);

  if (G.health <= 0) setTimeout(triggerGameOver, 1200);
}

// ════════════════════════════════════════════════════════════
//  GAME OVER / WIN
// ════════════════════════════════════════════════════════════
function triggerGameOver() {
  if (G.phase === 'gameover') return;
  G.phase = 'gameover';
  stopAllTimers();
  hideMonsterTimer();
  clearActiveSoundEvent();
  stopBgMusic();

  D.goTitle.textContent = 'YOU WERE TAKEN';
  D.goTitle.style.color = '';
  D.goMsg.textContent   = 'The monster claimed you in the night…';
  setTimeout(() => showScreen('gameover'), 400);
}

function triggerWin() {
  if (G.phase === 'win') return;
  G.phase = 'win';
  stopAllTimers();
  hideMonsterTimer();
  clearActiveSoundEvent();
  stopBgMusic();

  D.goTitle.textContent = 'MORNING HAS COME';
  D.goTitle.style.color = '#f0c060';
  D.goMsg.textContent   = 'You survived until dawn. The monsters are gone… for now.';
  showScreen('gameover');
}

// ════════════════════════════════════════════════════════════
//  UI UPDATES
// ════════════════════════════════════════════════════════════
function updateSanityBar() {
  const pct = Math.max(0, Math.min(100, G.sanity));
  D.sanityFill.style.width = pct + '%';
  D.sanityPct.textContent  = Math.round(pct) + '%';

  D.sanityFill.className = 'sanity-fill';
  if      (pct < C.SANITY_THRESHOLD) D.sanityFill.classList.add('danger');
  else if (pct < 30)                 D.sanityFill.classList.add('warning');
  else                               D.sanityFill.classList.add('safe');

  updateBgMusicVolume();
}

function updateHealthUI() {
  D.hearts.forEach((h, i) => h.classList.toggle('lost', i >= G.health));
}

let _warnTimer = null;
function setWarning(msg, autoClearMs = 0) {
  clearTimeout(_warnTimer);
  D.warning.textContent = msg;
  D.warning.classList.toggle('visible', !!msg);
  if (msg && autoClearMs) {
    _warnTimer = setTimeout(() => setWarning(''), autoClearMs);
  }
}

function updateTimer() {
  const rem = Math.max(0, C.WIN_SECONDS - G.survivalSec);
  const m   = Math.floor(rem / 60);
  const s   = (rem % 60).toString().padStart(2, '0');
  D.timer.textContent = `${m}:${s}`;
}

function triggerFlash() {
  D.flash.classList.add('active');
  setTimeout(() => D.flash.classList.remove('active'), 600);
}

// ════════════════════════════════════════════════════════════
//  KEYBOARD INPUT
// ════════════════════════════════════════════════════════════
function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (G.phase !== 'playing') return;

    switch (e.code) {
      case 'ArrowUp':
      case 'KeyW':
        e.preventDefault();
        G.keyUp = true; G.keyDown = false;
        break;
      case 'ArrowDown':
      case 'KeyS':
        e.preventDefault();
        G.keyDown = true; G.keyUp = false;
        break;
      case 'Space':
        e.preventDefault();
        pillowHit();
        break;
      case 'KeyF':
        if (!e.repeat) flashlightActivate();
        break;
      case 'KeyM':
        setTimeout(spawnWardrobeMonster, 100);
        break;
      case 'KeyB':
        setTimeout(spawnBedMonster, 100);
        break;
      case 'KeyP':
        setTimeout(spawnSoundEvent, 100);   // debug: ses olayı
        break;
    }
  });

  document.addEventListener('keyup', (e) => {
    switch (e.code) {
      case 'ArrowUp':   case 'KeyW': G.keyUp   = false; break;
      case 'ArrowDown': case 'KeyS': G.keyDown = false; break;
    }
  });
}

// ════════════════════════════════════════════════════════════
//  ON-SCREEN BUTTON CONTROLS
// ════════════════════════════════════════════════════════════
let knobAngle = -120;

function rotateKnob(dir) {
  knobAngle = Math.max(-140, Math.min(140, knobAngle + dir * 18));
  const marker = document.querySelector('.knob-marker');
  const knob   = document.querySelector('.musicbox-knob');
  if (marker) marker.style.transform = `translateX(-50%) rotate(${knobAngle}deg)`;
  if (knob)   knob.classList.toggle('spinning', dir > 0);
}

function initButtonControls() {
  const bindHold = (el, onDown, onUp) => {
    if (!el) return;
    el.addEventListener('mousedown',  onDown);
    el.addEventListener('touchstart', (e) => { e.preventDefault(); onDown(); }, { passive: false });
    el.addEventListener('mouseup',    onUp);
    el.addEventListener('mouseleave', onUp);
    el.addEventListener('touchend',   onUp);
  };

  bindHold(D.volUp,
    () => { G.keyUp = true;  G.keyDown = false; rotateKnob(+1); },
    () => { G.keyUp = false; document.querySelector('.musicbox-knob')?.classList.remove('spinning'); }
  );
  bindHold(D.volDown,
    () => { G.keyDown = true; G.keyUp = false; rotateKnob(-1); },
    () => { G.keyDown = false; }
  );

  if (D.flashBtn) {
    D.flashBtn.addEventListener('click', flashlightActivate);
    D.flashBtn.addEventListener('touchstart', (e) => { e.preventDefault(); flashlightActivate(); }, { passive: false });
  }

  if (D.pillowBtn) {
    const hitPillow = () => {
      D.pillowBtn.classList.add('hit');
      setTimeout(() => D.pillowBtn.classList.remove('hit'), 350);
      pillowHit();
    };
    D.pillowBtn.addEventListener('click', hitPillow);
    D.pillowBtn.addEventListener('touchstart', (e) => { e.preventDefault(); hitPillow(); }, { passive: false });
  }
}

// ════════════════════════════════════════════════════════════
//  ARDUINO WEBSOCKET BRIDGE
// ════════════════════════════════════════════════════════════
function initWebSocket() {
  try {
    const ws = new WebSocket('ws://localhost:3001');

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);

      if (msg.type === 'status') {
        G.arduinoConnected = msg.arduinoConnected;
        if (G.arduinoConnected) {
          D.arduinoTag.textContent = '🟢 Arduino';
          D.arduinoTag.style.color = '#78e878';
          if (D.simHint) D.simHint.style.display = 'none';
        }
      }

      if (msg.type === 'arduino' && G.phase === 'playing') {
        const { pot, piezo } = msg.data;
        const lux = msg.data.lux ?? msg.data.ldr ?? 0;  // Arduino'ya göre alan adı değişebilir

        // Potansiyometre: sadece yukarı çevirince sanity artar
        if (lastPot !== null) {
          G.keyUp = (pot - lastPot) > 8;
        }
        lastPot = pot;

        if (lux > C.FLASHLIGHT_LUX && !G.flashCooldown) flashlightActivate();
        if (piezo === 1) pillowHit();
      }
    };

    ws.onerror = () => {};
  } catch (_) {}
}

// ════════════════════════════════════════════════════════════
//  INIT
// ════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  cacheDOM();
  initAudio();
  initKeyboard();
  initButtonControls();
  initWebSocket();

  document.getElementById('btn-play').addEventListener('click', startGame);

  document.getElementById('btn-rules').addEventListener('click', () => {
    document.getElementById('rules-modal').classList.remove('hidden');
  });
  document.getElementById('btn-close-rules').addEventListener('click', () => {
    document.getElementById('rules-modal').classList.add('hidden');
  });

  document.getElementById('btn-restart').addEventListener('click', startGame);
  document.getElementById('btn-menu').addEventListener('click', () => showScreen('intro'));
});
