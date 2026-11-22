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
| HTML5 Audio API | Self-recorded m4a/mp3 sounds, dynamic timeout from audio duration |

No framework needed — the game state is a single JS object.

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
| Potentiometer | Music box volume — turning up increases sanity | A0 (wiper), 5V + GND (outers) |
| Piezo vibration sensor | Pillow hit detection | A5 + GND |
| LDR (photoresistor) | Flashlight detection | A2, in a voltage divider with a fixed resistor (5V, GND) |

### Arduino Libraries
None — the sketch only uses `analogRead`.

---

## How It Works

```
Physical Object              Arduino             Node.js Server           Browser Game
─────────────────────────    ──────────────    ────────────────────    ─────────────────
Potentiometer turned up ──►  A0 analog read  ──►  Serial → JSON     ──►  sanity bar rises
Pillow hit              ──►  A5 piezo hit    ──►  piezo: 1 event    ──►  repel bed monster / respond to sound
Flashlight on wardrobe  ──►  A2 LDR read     ──►  ldr: 650         ──►  ldr > 500 → repel wardrobe monster
                                                    WebSocket push
```

Arduino sends every 100ms:
```json
{"pot":812,"piezo":0,"piezoRaw":0,"ldr":45}
```

The potentiometer controls sanity via **delta** — turning it clockwise increases sanity. Holding it still or turning it back does nothing; sanity decays naturally on its own.

---

## Game Mechanics

### Event Queue
One event at a time, chosen randomly (each ~33% chance):

| Event | Cue | Correct Response |
|---|---|---|
| Wardrobe monster (visual) | Room image changes — monster in wardrobe | Flashlight (F / shine light) |
| Bed monster (visual) | Room image changes — monster under bed + red glow | Pillow (Space / hit) |
| Monster sound (audio only) | You hear a monster sound, no visual change | Pillow within sound duration |
| Parent decoy sound (audio only) | You hear a parent-like sound, no visual change | Do nothing |

### False Positive System
Reacting incorrectly triggers the parent system:
- **Wrong reaction to sound event** (flashlight when pillow was needed, or reacting to a parent decoy)
- **Acting when no event is active** (pressing Space or F with nothing happening)

| Mistake count | Consequence |
|---|---|
| 1st false positive | Mother enters — random voice line plays; scene ends when audio finishes |
| 2nd false positive | Father enters — random voice line plays; game over after audio ends |

### Audio System
All sounds are self-recorded. Categories:

| File pattern | When it plays | Player should |
|---|---|---|
| `monster_sound_*` | Sound-only monster event | Hit pillow within sound duration |
| `footsteps_monster` | Sound-only monster event | Hit pillow within sound duration |
| `parents_*` / `footsteps_parents` | Parent decoy event | Do nothing |
| `mother_sound_1–5` | Mother visit scene | Wait (random one plays, scene lasts until audio ends) |
| `father_sound_1–5` | Father visit scene | Wait (game over after audio ends) |
| `horror-music-box_sound.mp3` | Background loop | Volume tracks sanity — lower sanity = quieter music |

---

## Game States

```
intro ──[PLAY]──► playing
                    │
                    ├── idle                (normal room)
                    ├── monster_wardrobe    (monster in wardrobe — needs flashlight)
                    ├── flashlight_on       (flashlight shining on monster)
                    ├── bed_monster         (monster under bed — needs pillow)
                    ├── bed_monster_pillow  (pillow hit animation, brief)
                    └── parents             (parent enters after false positive)
                    │
                    ├──[health = 0]──► gameover
                    └──[180 sec]────► win
```

### Penalty System
| Mistake | Consequence |
|---|---|
| Sanity drops below 20% while a visual monster is active | Lose 1 heart |
| Visual monster not addressed within 5s | Lose 1 heart |
| Monster sound not answered with pillow within sound duration | False positive |
| Reacting to parent decoy or acting with no event | False positive |
| 2nd false positive | Father arrives → game over |

---

## Setup

### Option A — No Arduino (Keyboard / Mouse Simulation)

Run `npm start` and open `http://localhost:3001`. Click the on-screen objects or use keyboard:

| Key | Action |
|---|---|
| W / ↑ (hold) | Turn music box up (fill sanity) |
| F (single press) | Flashlight — auto-off after 1 s |
| Space | Hit pillow |
| M | Spawn wardrobe monster (debug) |
| B | Spawn bed monster (debug) |
| P | Trigger sound event (debug) |

### Option B — With Arduino + Node.js Server

1. **Install dependencies**
   ```bash
   cd echoes_of_the_Night
   npm install
   ```

2. **Upload Arduino sketch**
   - Open `echoes_of_night.ino` in Arduino IDE
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

## Sensor Tuning

Edit constants in `public/game.js` (the `C` object near the top):

| Parameter | Constant | Default | Notes |
|---|---|---|---|
| Flashlight LDR threshold (0–1023) | `FLASHLIGHT_LUX` | 500 | Raise if room is bright |
| Sanity danger threshold | `SANITY_THRESHOLD` | 20% | Below this + visual monster → attack |
| Monster reaction window | `MONSTER_TIMEOUT` | 5 000 ms | Time to respond to visual monster |
| Monster spawn interval | `MONSTER_SPAWN_MIN/MAX` | 1–15 s | Adjust difficulty |
| Win time | `WIN_SECONDS` | 180 s | Survive this long to win |

Piezo sensitivity and debounce are set in `echoes_of_night.ino` (`piezoRaw > 1`, `PIEZO_DEBOUNCE_MS` = 300 ms).

---

*Echoes of the Night — VAS455 Interactive Media Project, Sabancı University*
