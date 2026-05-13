/**
 * Echoes of the Night — Game Engine
 *
 * State machine:
 *   Phase:    intro → playing → gameover | win
 *   Room:     idle | monster_wardrobe | flashlight_on | parents
 *
 * Controls:
 *   W / ↑     Hold — music box volume up
 *   F         Press once — flashlight (auto-off after 1 s)
 *   Space     Press once — hit the pillow
 *   M / B     Debug: spawn wardrobe / bed monster
 */

'use strict';

// ════════════════════════════════════════════════════════════
//  ASSET PATHS  ← sadece buraya bak, başka yerde değişiklik gerekmez
// ════════════════════════════════════════════════════════════
const ASSETS = {
  images: {
    idle          : 'images/room_idle.jpg',
    monster       : 'images/room_wardrobe_monster.png',
    flashlight    : 'images/room_flashlight.png',
    parents       : 'images/room_parents.png',
    bedMonster    : 'images/room_monster_under_bed_nopillow.png',
    bedPillow     : 'images/room_monster_under_bed_pillow.png',
  },
  audio: {
    // public/audio/ klasörüne MP3 koyunca otomatik çalışır
    monsterGrowl  : 'audio/monster_growl.mp3',
    pillowHit     : 'audio/pillow_hit.mp3',
    motherWarning : 'audio/mother_warning.mp3',
    fatherFatal   : 'audio/father_fatal.mp3',
    musicBox      : 'audio/music_box.mp3',
    monsterAttack : 'audio/monster_attack.mp3',
  }
};

// ════════════════════════════════════════════════════════════
//  CONSTANTS
// ════════════════════════════════════════════════════════════
const C = Object.freeze({
  TICK_MS             : 200,
  SANITY_DECAY        : 0.12,
  SANITY_REGEN        : 6,
  SANITY_THRESHOLD    : 20,
  SANITY_DRAIN_KEY    : 3,

  MONSTER_SPAWN_MIN   : 1000,
  MONSTER_SPAWN_MAX   : 15000,
  MONSTER_TIMEOUT     : 5000,
  BED_SPAWN_MIN       : 1000,
  BED_SPAWN_MAX       : 15000,
  BED_TIMEOUT         : 5000,

  // Flashlight: tek tuşa basınca 1 saniye açık kalır, sonra kapanır
  FLASHLIGHT_DURATION : 1000,
  FLASHLIGHT_COOLDOWN : 1200,  // sonraki kullanım için bekleme
  FLASHLIGHT_LUX      : 180,

  WIN_SECONDS         : 180,
});

// ════════════════════════════════════════════════════════════
//  GAME STATE
// ════════════════════════════════════════════════════════════
let G = {
  phase       : 'intro',
  roomState   : 'idle',
  health      : 3,
  sanity      : 78,

  wardrobeMonster    : false,
  bedMonster         : false,
  attacked           : false,
  falsePositiveCount : 0,

  keyUp         : false,
  keyDown       : false,
  flashOn       : false,
  flashCooldown : false,   // tek tuş sonrası spam önler

  arduinoConnected : false,
  survivalSec      : 0,

  _loop    : null,
  _clock   : null,
  _wSpawn  : null,
  _bSpawn  : null,
  _wAttack : null,
  _bAttack : null,
  _wRepel  : null,
  _mtInt   : null,   // monster countdown interval
};

// ════════════════════════════════════════════════════════════
//  AUDIO SYSTEM
//  — Dosya yoksa sessizce atlar; dosya eklenince çalışır
// ════════════════════════════════════════════════════════════
const sfx = {};

function initAudio() {
  Object.entries(ASSETS.audio).forEach(([key, path]) => {
    try {
      sfx[key] = new window.Audio(path);
      sfx[key].load();
    } catch (_) {}
  });
  if (sfx.musicBox) sfx.musicBox.loop = true;
}

function play(key) {
  const s = sfx[key];
  if (!s) return;
  s.currentTime = 0;
  s.play().catch(() => {});
}

// ════════════════════════════════════════════════════════════
//  DOM CACHE
// ════════════════════════════════════════════════════════════
let D = {};

function cacheDOM() {
  D.screens = {
    intro    : document.getElementById('screen-intro'),
    game     : document.getElementById('screen-game'),
    gameover : document.getElementById('screen-gameover'),
  };
  D.rooms = {
    idle               : document.getElementById('room-idle'),
    monster_wardrobe   : document.getElementById('room-monster'),
    flashlight_on      : document.getElementById('room-flashlight'),
    parents            : document.getElementById('room-parents'),
    bed_monster        : document.getElementById('room-bed-monster'),
    bed_monster_pillow : document.getElementById('room-bed-pillow'),
  };

  D.rooms.idle.src               = ASSETS.images.idle;
  D.rooms.monster_wardrobe.src   = ASSETS.images.monster;
  D.rooms.flashlight_on.src      = ASSETS.images.flashlight;
  D.rooms.parents.src            = ASSETS.images.parents;
  D.rooms.bed_monster.src        = ASSETS.images.bedMonster;
  D.rooms.bed_monster_pillow.src = ASSETS.images.bedPillow;

  const introBg = document.querySelector('.intro-bg');
  if (introBg) introBg.style.backgroundImage = `url('${ASSETS.images.idle}')`;

  D.sanityFill   = document.getElementById('sanity-fill');
  D.sanityPct    = document.getElementById('sanity-pct');
  D.hearts       = document.querySelectorAll('.heart-icon');
  D.warning      = document.getElementById('warning-msg');
  D.flash        = document.getElementById('attack-flash');
  D.timer        = document.getElementById('survival-timer');
  D.goTitle      = document.getElementById('go-title');
  D.goMsg        = document.getElementById('go-msg');
  D.arduinoTag   = document.getElementById('arduino-tag');
  D.simHint      = document.getElementById('sim-hint');
  D.flashBtn     = document.getElementById('btn-flashlight');
  D.pillowBtn    = document.getElementById('btn-pillow');
  D.volUp        = document.getElementById('btn-vol-up');
  D.volDown      = document.getElementById('btn-vol-down');

  // Monster countdown timer
  D.monsterTimer = document.getElementById('monster-timer');
  D.mtCount      = document.getElementById('mt-count');
  D.mtArc        = document.getElementById('mt-arc');
}

// ════════════════════════════════════════════════════════════
//  MONSTER COUNTDOWN TIMER
//  — Sadece görsel canavar çıktığında başlar (ses tuzaklarında değil)
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

  prev.classList.add('fade-out');
  setTimeout(() => {
    prev.classList.remove('active', 'fade-out');
    G.roomState = state;
    next.classList.add('active');
  }, 350);
}

// ════════════════════════════════════════════════════════════
//  GAME START / RESET
// ════════════════════════════════════════════════════════════
function startGame() {
  stopAllTimers();
  hideMonsterTimer();

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

  Object.values(D.rooms).forEach(r => r.classList.remove('active', 'fade-out'));
  D.rooms.idle.classList.add('active');
  document.getElementById('screen-game').classList.remove('bed-glow');

  updateHealthUI();
  updateSanityBar();
  setWarning('');
  updateTimer();

  showScreen('game');

  G._loop  = setInterval(gameTick, C.TICK_MS);
  G._clock = setInterval(clockTick, 1000);

  scheduleWardrobeMonster();
  scheduleBedMonster();
}

function stopAllTimers() {
  [G._loop, G._clock, G._wSpawn, G._bSpawn, G._wAttack, G._bAttack, G._wRepel, G._mtInt]
    .forEach(t => { if (t) { clearTimeout(t); clearInterval(t); } });
}

// ════════════════════════════════════════════════════════════
//  GAME LOOP (her TICK_MS'de bir)
// ════════════════════════════════════════════════════════════
function gameTick() {
  if (G.phase !== 'playing') return;

  if (!G.arduinoConnected) {
    if (G.keyUp) {
      G.sanity = Math.min(100, G.sanity + C.SANITY_REGEN);
    } else {
      const extra = G.keyDown ? C.SANITY_DRAIN_KEY : 0;
      G.sanity = Math.max(0, G.sanity - C.SANITY_DECAY - extra);
    }
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
//  MONSTER SPAWNING
// ════════════════════════════════════════════════════════════
function scheduleWardrobeMonster() {
  const d = C.MONSTER_SPAWN_MIN + Math.random() * (C.MONSTER_SPAWN_MAX - C.MONSTER_SPAWN_MIN);
  G._wSpawn = setTimeout(spawnWardrobeMonster, d);
}

function spawnWardrobeMonster() {
  if (G.phase !== 'playing' || G.wardrobeMonster) return;
  G.wardrobeMonster = true;
  setRoom('monster_wardrobe');
  setWarning('👁  SOMETHING IS IN THE WARDROBE — SHINE YOUR FLASHLIGHT!');
  play('monsterGrowl');
  showMonsterTimer(C.MONSTER_TIMEOUT / 1000);   // ← timer başlar

  G._wAttack = setTimeout(() => {
    if (G.wardrobeMonster) monsterAttack('wardrobe_timeout');
  }, C.MONSTER_TIMEOUT);
}

function repelWardrobeMonster() {
  if (!G.wardrobeMonster) return;
  G.wardrobeMonster = false;
  clearTimeout(G._wAttack);
  hideMonsterTimer();                           // ← timer durur
  setRoom('idle');
  setWarning('✓  Monster driven back!', 1800);
  scheduleWardrobeMonster();
}

function scheduleBedMonster() {
  const d = C.BED_SPAWN_MIN + Math.random() * (C.BED_SPAWN_MAX - C.BED_SPAWN_MIN);
  G._bSpawn = setTimeout(spawnBedMonster, d);
}

function spawnBedMonster() {
  if (G.phase !== 'playing' || G.bedMonster) return;
  G.bedMonster = true;
  document.getElementById('screen-game').classList.add('bed-glow');
  setRoom('bed_monster');                        // ← yatak canavarı görseli
  setWarning('💀  SOMETHING UNDER THE BED — HIT THE PILLOW!');
  play('monsterGrowl');
  showMonsterTimer(C.BED_TIMEOUT / 1000);

  G._bAttack = setTimeout(() => {
    if (G.bedMonster) monsterAttack('bed_timeout');
  }, C.BED_TIMEOUT);
}

function repelBedMonster() {
  if (!G.bedMonster) return;
  G.bedMonster = false;
  clearTimeout(G._bAttack);
  hideMonsterTimer();
  document.getElementById('screen-game').classList.remove('bed-glow');
  setRoom('bed_monster_pillow');                 // ← yastık çarptı, kısa an göster
  setWarning('✓  Under-bed monster scared away!', 1800);
  setTimeout(() => { if (G.phase === 'playing') setRoom('idle'); }, 700);
  scheduleBedMonster();
}

// ════════════════════════════════════════════════════════════
//  PLAYER ACTIONS
// ════════════════════════════════════════════════════════════

// ── Flashlight — tek tuş, 1 saniye sonra otomatik kapanır ──
function flashlightActivate() {
  if (G.phase !== 'playing' || G.flashCooldown) return;
  G.flashOn     = true;
  G.flashCooldown = true;

  if (G.wardrobeMonster) {
    setRoom('flashlight_on');
    setWarning('💡  FLASHLIGHT ON!');
    G._wRepel = setTimeout(() => {
      G.flashOn = false;
      if (G.wardrobeMonster) repelWardrobeMonster();
      setTimeout(() => { G.flashCooldown = false; }, 200);
    }, C.FLASHLIGHT_DURATION);
  } else {
    // Canavar yokken feneri açmak → yanlış alarm
    G.flashOn = false;
    setTimeout(() => { G.flashCooldown = false; }, C.FLASHLIGHT_COOLDOWN);
    falsePositive();
  }
}

// ── Pillow — tek tuş ────────────────────────────────────────
function pillowHit() {
  if (G.phase !== 'playing') return;
  play('pillowHit');

  if (G.bedMonster) {
    repelBedMonster();
  } else {
    falsePositive();
  }
}

// ── False Positive / Parent System ──────────────────────────
function falsePositive() {
  G.falsePositiveCount++;
  if (G.falsePositiveCount === 1) {
    showParent('mother');
  } else {
    showParent('father');
  }
}

function showParent(who) {
  setRoom('parents');
  // NOT: ebeveyn sahnesi için timer başlamaz — bu kasıtlı (ses tuzağı tasarımı)

  if (who === 'mother') {
    play('motherWarning');
    setWarning('🚪  YOUR MOTHER IS HERE. Settle down — first warning!');
    setTimeout(() => {
      if (G.phase === 'playing') { setRoom('idle'); setWarning(''); }
    }, 3500);
  } else {
    play('fatherFatal');
    setWarning('🚪  YOUR FATHER ARRIVED. There is no escape now...');
    G.health = 0;
    updateHealthUI();
    setTimeout(triggerGameOver, 2200);
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
  play('monsterAttack');

  G.flashOn     = false;
  G.flashCooldown = false;

  const msgs = {
    sanity          : '🩸  THE MUSIC STOPPED... IT CAME FOR YOU!',
    wardrobe_timeout: '🩸  YOU LOOKED AWAY TOO LONG!',
    bed_timeout     : '🩸  IT GRABBED YOU FROM BELOW!',
  };
  setWarning(msgs[reason] || '🩸  MONSTER ATTACK!');

  if (G.wardrobeMonster) { G.wardrobeMonster = false; clearTimeout(G._wAttack); scheduleWardrobeMonster(); }
  if (G.bedMonster)      { G.bedMonster = false;      clearTimeout(G._bAttack); scheduleBedMonster(); }
  document.getElementById('screen-game').classList.remove('bed-glow');
  setRoom('idle');

  setTimeout(() => {
    G.attacked = false;
    if (G.phase === 'playing') setWarning('');
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
        if (!e.repeat) flashlightActivate();  // e.repeat: tuş basılı tutulursa ateşleme
        break;
      case 'KeyM':
        setTimeout(spawnWardrobeMonster, 100);
        break;
      case 'KeyB':
        setTimeout(spawnBedMonster, 100);
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

  // Müzik kutusu — basılı tut
  bindHold(D.volUp,
    () => { G.keyUp = true;  G.keyDown = false; rotateKnob(+1); },
    () => { G.keyUp = false; document.querySelector('.musicbox-knob')?.classList.remove('spinning'); }
  );
  bindHold(D.volDown,
    () => { G.keyDown = true; G.keyUp = false; rotateKnob(-1); },
    () => { G.keyDown = false; }
  );

  // Fener — tek tıklama (hold gerekmez)
  if (D.flashBtn) {
    D.flashBtn.addEventListener('click', flashlightActivate);
    D.flashBtn.addEventListener('touchstart', (e) => { e.preventDefault(); flashlightActivate(); }, { passive: false });
  }

  // Yastık — tek tıklama + sıçrama animasyonu
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
        const { pot, piezo, lux } = msg.data;

        G.sanity = (pot / 1023) * 100;

        // Fener: yükselen kenar (flashlight yeni açıldıysa) → tek tetikleme
        const luxOn = lux > C.FLASHLIGHT_LUX;
        if (luxOn && !G.flashCooldown) flashlightActivate();

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
