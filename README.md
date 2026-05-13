# Echoes of the Night
> Interactive survival-horror game — VAS455 Project by Beren Güler

A fixed-perspective bedroom horror experience where physical hardware objects (pillow, flashlight, music-box knob) become game controllers via Arduino.

---

## Tech Stack

### Frontend — Game UI
| Technology | Role |
|---|---|
| HTML5 / CSS3 / Vanilla JS | Game engine, UI, state machine |
| CSS custom properties | Theming and atmospheric palette |
| CSS animations & transitions | Room image crossfades, sanity pulse, flicker effects |
| Google Fonts (Cinzel + Crimson Pro) | Typography — classical horror meets storybook |
| Web Audio API | (placeholder slots for self-recorded audio) |

No framework needed — the game state is a single JS object; React/Vue would add complexity without benefit for this use case.

### Backend — Arduino Bridge
| Technology | Role |
|---|---|
| Node.js | Runtime |
| Express.js | Serves the `public/` folder as static files |
| `ws` (WebSocket library) | Real-time push from server → browser (no polling) |
| `serialport` | Reads Arduino JSON output from USB serial port |
| `@serialport/parser-readline` | Splits serial stream into complete JSON lines |

### Hardware / Arduino
| Component | Role | Connection |
|---|---|---|
| Arduino Uno | Reads all sensors, serializes to JSON | USB → computer |
| Potentiometer | Music box volume (sanity level) | A0 (wiper), 5V + GND (outers) |
| Piezo vibration sensor | Pillow hit detection | A1 + GND |
| GY-30 BH1750 light sensor | Flashlight lux detection | A4 (SDA), A5 (SCL), 3.3V, GND |
| 22 AWG stranded wire | Non-invasive sensor integration | — |
| Conductive copper tape | Pillow sensor mounting | — |

### Arduino Library Required
- **BH1750** by Christopher Laws — install via Arduino IDE → Tools → Manage Libraries → search "BH1750"

---

## How It Works

```
Physical Object              Arduino             Node.js Server           Browser Game
─────────────────────────    ──────────────    ────────────────────    ─────────────────
Potentiometer turned    ──►  A0 analog read  ──►  Serial → JSON     ──►  sanity bar fill
Pillow hit              ──►  A1 piezo > 80   ──►  piezo: 1 event    ──►  repel bed monster
Flashlight on wardrobe  ──►  I2C lux > 180   ──►  lux: 450.0        ──►  repel wardrobe monster
                                                    WebSocket push
```

Arduino sends every 100ms:
```json
{"pot":812,"piezo":0,"lux":45.0}
```

---

## Game States

```
intro ──[PLAY]──► playing
                    │
                    ├── idle          (normal room)
                    ├── monster_wardrobe  (monster visible without flashlight)
                    ├── flashlight_on    (girl with flashlight, monster revealed)
                    └── parents          (parent enters after false positive)
                    │
                    ├──[health = 0]──► gameover
                    └──[180 sec]────► win
```

### Penalty System
| Mistake | Consequence |
|---|---|
| Sanity drops below 10% while monster is active | Lose 1 heart |
| Monster not addressed within 14s (wardrobe) / 10s (bed) | Lose 1 heart |
| False positive (wrong action when no monster) — 1st | Mother enters (warning) |
| False positive — 2nd | Father enters → instant game over |

---

## Setup

### Option A — No Arduino (Keyboard Simulation)
Just open `public/index.html` in a browser. No server needed.

| Key | Action |
|---|---|
| W / ↑ (hold) | Turn music box up (fill sanity) |
| F (hold) | Flashlight on wardrobe |
| Space | Hit pillow |
| M | Spawn wardrobe monster (debug) |
| B | Spawn under-bed monster (debug) |

### Option B — With Arduino + Node.js Server

1. **Install dependencies**
   ```bash
   cd echoes-of-the-night
   npm install
   ```

2. **Upload Arduino sketch**
   - Open `arduino/echoes_of_night.ino` in Arduino IDE
   - Install BH1750 library (Tools → Manage Libraries → "BH1750")
   - Wire hardware per wiring table above
   - Upload to Arduino Uno

3. **Find your serial port**
   - Linux/Mac: `/dev/ttyACM0` or `/dev/ttyUSB0`
   - Windows: `COM3`, `COM4`, etc. (check Device Manager)

4. **Run server**
   ```bash
   # Default port /dev/ttyACM0:
   npm start

   # Or specify port:
   ARDUINO_PORT=/dev/ttyUSB0 npm start       # Linux/Mac
   set ARDUINO_PORT=COM4 && npm start         # Windows
   ```

5. **Open game**: `http://localhost:3001`

### Development
```bash
npm run dev       # auto-restarts server on file changes (nodemon)
```

---

## Adding Audio

The game has placeholder hooks for audio. To add self-recorded sounds, edit `public/game.js`:

```javascript
// Example: play a monster growl when wardrobe monster spawns
function spawnWardrobeMonster() {
  // ... existing code ...
  playSound('monster_growl.mp3');   // add your audio file to public/audio/
}
```

Add an `AudioManager` object:
```javascript
const sounds = {};
function loadSounds() {
  ['monster_growl', 'pillow_hit', 'mother_warning', 'father_fatal', 'music_box']
    .forEach(name => {
      sounds[name] = new Audio(`audio/${name}.mp3`);
    });
}
function playSound(name) {
  if (sounds[name]) { sounds[name].currentTime = 0; sounds[name].play(); }
}
```

---

## Sensor Tuning

Edit these values in `game.js` constants or `arduino/echoes_of_night.ino`:

| Parameter | Where | Default | Notes |
|---|---|---|---|
| Flashlight lux threshold | `game.js` → `C.FLASHLIGHT_LUX` | 180 | Raise if room is bright |
| Piezo hit threshold | `.ino` → `PIEZO_HIT_THRESHOLD` | 80 | Lower if pillow is dense |
| Sanity threshold | `game.js` → `C.SANITY_THRESHOLD` | 10% | Below this → monster attacks |
| Monster spawn interval | `game.js` → `C.MONSTER_SPAWN_MIN/MAX` | 22–38s | Adjust difficulty |
| Win time | `game.js` → `C.WIN_SECONDS` | 180s | Presentation session length |

---

*Echoes of the Night — VAS455 Interactive Media Project, Sabancı University*
