# AC-130 SPECTRE — Browser-Based Gunship Game

A fully browser-based 3D AC-130 gunship combat game rendered in real-time with WebGL (Three.js) and a FLIR thermal imaging visual style.

---

## How to Run

### Option A — Local web server (recommended)

1. Install [Node.js](https://nodejs.org) if you haven't already.
2. Open a terminal in this folder and run:
   ```
   npx serve .
   ```
   or with Python:
   ```
   python -m http.server 8080
   ```
3. Open your browser to `http://localhost:8080` (or the port shown).

### Option B — VS Code Live Server

1. Install the **Live Server** extension in VS Code.
2. Right-click `index.html` → **Open with Live Server**.

> **Note:** The game will not function correctly when opened directly from the filesystem (`file://`) because Three.js is loaded from CDN and the browser blocks mixed-content. Use a local server.

---

## Controls

| Input | Action |
|-------|--------|
| **Mouse Move** | Aim targeting reticle |
| **Left Click / Hold** | Fire selected weapon |
| **1** | Select 25mm Gatling Gun |
| **2** | Select 40mm Cannon |
| **3** | Select 105mm Howitzer |
| **Scroll Wheel** | Zoom in / out |
| **R** | Manual reload |

---

## Gameplay

- The camera circles the battlefield in a realistic AC-130 orbit pattern.
- All visuals are rendered through a **FLIR thermal shader** — hot objects glow white/yellow, cold terrain is dark.
- **Enemies** (infantry and vehicles) patrol the map and advance on friendly units.
- **Friendlies** (infantry and convoy vehicles) must be protected — friendly fire penalises your score.
- **Buildings** can be damaged and destroyed with sustained fire.
- Missions escalate in difficulty with more enemies and reinforcements.
- Score is tallied per kill, with bonuses for saved friendlies.

---

## Weapons

| Weapon | Fire Rate | Damage | AOE | Ammo |
|--------|-----------|--------|-----|------|
| 25mm Gatling | Very fast | 15 | None | Unlimited |
| 40mm Cannon | Medium | 60 | 8m radius | 60 rounds |
| 105mm Howitzer | Slow (5.5s) | 200 | 22m radius | 20 rounds |

40mm and 105mm rounds reload automatically when empty. Press **R** to start a manual reload early.

---

## File Structure

```
AC130/
├── index.html          Entry point & HUD markup
├── css/
│   └── style.css       All styles (HUD, thermal effects, screens)
├── js/
│   ├── utils.js        Shared math / helper utilities
│   ├── audio.js        Web Audio API sound synthesis
│   ├── thermal.js      FLIR post-processing shader (Three.js)
│   ├── terrain.js      Procedural terrain, buildings, lighting
│   ├── entities.js     Enemy & friendly AI, mesh creation
│   ├── weapons.js      Weapons definitions, fire/reload logic
│   ├── effects.js      Explosions, smoke, tracers, screen shake
│   ├── hud.js          HUD DOM management, kill feed, radio
│   ├── mission.js      Mission objectives, scoring, radio chatter
│   └── game.js         Main loop, camera, input, orchestration
└── README.md
```

---

## Technical Notes

- Requires a modern browser with **WebGL 2** support (Chrome, Edge, Firefox).
- Desktop performance target: 60 FPS at 1080p on a mid-range GPU.
- Three.js r128 is loaded from CDN — an internet connection is required on first load, or you can download `three.min.js` and serve it locally.
- Weapon, ambient, and UI audio are synthesised via the **Web Audio API**. Mission briefing and ambient radio chatter use MP3 files from `StartVoice/` and `RandomVoice/`.
- The thermal imaging effect is a custom GLSL fragment shader applied as a full-screen post-processing pass.
# fromabove
