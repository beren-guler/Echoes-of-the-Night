/**
 * Echoes of the Night — Game Server
 *
 * Serves the game frontend and bridges Arduino serial input
 * to the browser via WebSocket.
 *
 * Arduino wiring summary:
 *   A0  → Potentiometer (music box volume, 0–1023)
 *   A1  → Piezo vibration sensor (pillow hit detection)
 *   A4/A5 → GY-30 BH1750 light sensor via I2C (flashlight lux)
 *
 * Serial output from Arduino (100ms interval):
 *   {"pot":512,"piezo":0,"lux":45.0}
 */

const express = require('express');
const http    = require('http');
const WebSocket = require('ws');
const path    = require('path');

// Try to import serialport — won't crash if unavailable
let SerialPort, ReadlineParser;
try {
  ({ SerialPort } = require('serialport'));
  ({ ReadlineParser } = require('@serialport/parser-readline'));
} catch (_) {}

// ─── Config ─────────────────────────────────────────────────
const WEB_PORT     = process.env.PORT       || 3001;
const SERIAL_PORT  = process.env.ARDUINO_PORT || '/dev/ttyACM0'; // Windows: COM3
const BAUD_RATE    = 9600;

// ─── Express + HTTP ─────────────────────────────────────────
const app    = express();
const server = http.createServer(app);

app.use(express.static(path.join(__dirname, 'public')));

// ─── WebSocket Server ────────────────────────────────────────
const wss = new WebSocket.Server({ server });

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  });
}

wss.on('connection', (ws) => {
  console.log('  ↳ Browser client connected');
  // Tell client whether Arduino is live
  ws.send(JSON.stringify({ type: 'status', arduinoConnected }));

  ws.on('close', () => console.log('  ↳ Browser client disconnected'));
});

// ─── Arduino Serial ──────────────────────────────────────────
let arduinoConnected = false;

function tryConnectArduino() {
  if (!SerialPort) {
    console.log('⚠  serialport not installed — keyboard simulation only');
    console.log('   Run: npm install   to enable Arduino support\n');
    return;
  }

  try {
    const port   = new SerialPort({ path: SERIAL_PORT, baudRate: BAUD_RATE });
    const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

    port.on('open', () => {
      arduinoConnected = true;
      console.log(`✓  Arduino connected on ${SERIAL_PORT}`);
      broadcast({ type: 'status', arduinoConnected: true });
    });

    parser.on('data', (raw) => {
      try {
        const data = JSON.parse(raw.trim());
        broadcast({ type: 'arduino', data });
      } catch (_) { /* malformed line — skip */ }
    });

    port.on('error', (err) => {
      console.log(`⚠  Serial error: ${err.message}`);
      arduinoConnected = false;
    });

    port.on('close', () => {
      arduinoConnected = false;
      console.log('⚠  Arduino disconnected — retrying in 5s');
      setTimeout(tryConnectArduino, 5000);
    });

  } catch (err) {
    console.log(`⚠  Could not open ${SERIAL_PORT}: ${err.message}`);
    console.log('   Set ARDUINO_PORT env var for the correct port.');
    console.log('   Game running in keyboard simulation mode.\n');
  }
}

// ─── Start ───────────────────────────────────────────────────
server.listen(WEB_PORT, () => {
  console.log('\n╔═══════════════════════════════════════╗');
  console.log('║     ECHOES OF THE NIGHT — Server      ║');
  console.log('╚═══════════════════════════════════════╝');
  console.log(`\n🎮  Open in browser → http://localhost:${WEB_PORT}`);
  tryConnectArduino();
});
