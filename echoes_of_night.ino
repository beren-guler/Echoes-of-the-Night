const int PIN_POT   = A0;
const int PIN_LDR   = A2;
const int PIN_PIEZO = A5;


unsigned long lastPiezoHit = 0;
const unsigned long PIEZO_DEBOUNCE_MS = 300;

unsigned long lastSend = 0;
const unsigned long SEND_INTERVAL = 100;

void setup() {
  Serial.begin(9600);
  pinMode(PIN_PIEZO, INPUT);
}

void loop() {
  unsigned long now = millis();
  if (now - lastSend < SEND_INTERVAL) return;
  lastSend = now;

  int potValue = analogRead(PIN_POT);
  int ldrValue = analogRead(PIN_LDR);
  int piezoRaw = analogRead(PIN_PIEZO);

   int piezoHit = 0;
  if (piezoRaw > 1 && (now - lastPiezoHit > PIEZO_DEBOUNCE_MS)) {
    piezoHit     = 1;
    lastPiezoHit = now;
  }

  Serial.print(F("{\"pot\":"));
  Serial.print(potValue);
  Serial.print(F(",\"piezo\":"));
  Serial.print(piezoHit);
  Serial.print(F(",\"piezoRaw\":"));
  Serial.print(piezoRaw);
  Serial.print(F(",\"ldr\":"));
  Serial.print(ldrValue);
  Serial.println(F("}"));
}