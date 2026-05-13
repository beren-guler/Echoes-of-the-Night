/**
 * Echoes of the Night — Arduino Sketch
 *
 * Wiring:
 *   Potentiometer   : outer pins → 5V & GND, middle (wiper) → A0
 *   Piezo sensor    : signal → A1, GND → GND  (or use Piezo module with S/G/VCC pins)
 *   GY-30 BH1750    : VCC→3.3V, GND→GND, SDA→A4, SCL→A5
 *
 * Output (9600 baud, 100ms interval):
 *   {"pot":512,"piezo":0,"lux":45.0}
 *
 * Required library: BH1750 by Christopher Laws  (Tools > Manage Libraries)
 */

#include <Wire.h>
#include <BH1750.h>

// ── Pin definitions ──────────────────────────────────────────
const int PIN_POT   = A0;
const int PIN_PIEZO = A1;

// ── Thresholds ───────────────────────────────────────────────
// Piezo: raw ADC value above which we consider a "hit"
const int PIEZO_HIT_THRESHOLD = 80;
// Debounce: ignore piezo for N ms after a hit
const unsigned long PIEZO_DEBOUNCE_MS = 300;

// ── Globals ──────────────────────────────────────────────────
BH1750 lightMeter;
unsigned long lastPiezoHit = 0;
unsigned long lastSend     = 0;
const unsigned long SEND_INTERVAL = 100; // ms

void setup() {
  Serial.begin(9600);
  Wire.begin();

  if (!lightMeter.begin(BH1750::CONTINUOUS_HIGH_RES_MODE)) {
    // Light sensor not found — will output lux=0 gracefully
  }
}

void loop() {
  unsigned long now = millis();
  if (now - lastSend < SEND_INTERVAL) return;
  lastSend = now;

  // ── Read sensors ──────────────────────────────────────────
  int  potValue   = analogRead(PIN_POT);
  int  piezoRaw   = analogRead(PIN_PIEZO);
  float lux       = lightMeter.readLightLevel();
  if (lux < 0) lux = 0; // sensor not ready yet

  // ── Piezo debounce — send 1 only on fresh hit ─────────────
  int piezoHit = 0;
  if (piezoRaw > PIEZO_HIT_THRESHOLD && (now - lastPiezoHit > PIEZO_DEBOUNCE_MS)) {
    piezoHit    = 1;
    lastPiezoHit = now;
  }

  // ── Transmit JSON ─────────────────────────────────────────
  Serial.print(F("{\"pot\":"));
  Serial.print(potValue);
  Serial.print(F(",\"piezo\":"));
  Serial.print(piezoHit);
  Serial.print(F(",\"lux\":"));
  Serial.print(lux, 1);
  Serial.println(F("}"));
}
