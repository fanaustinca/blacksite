# BLACKSITE

A retro-modern first-person shooter in the browser. Procedurally generated
industrial sectors, tactical enemy AI, dynamic lighting with a flashlight,
procedural textures and sound — zero external assets, no build step.

Built with [Three.js](https://threejs.org/) (vendored, no CDN dependency).

## Play

- **Desktop (Windows/Mac/Linux):** any modern browser. Click to lock the mouse.
  - WASD move · mouse aim · click fire · **R** reload · **Shift** sprint · Esc pause
- **Android / iOS:** left thumb = virtual stick (move), right thumb = drag to aim,
  FIRE button to shoot. Installable as a PWA (Add to Home Screen) and playable offline.

Clear all hostiles in the sector to advance. Each sector is bigger and
holds more enemies.

## Run locally

Any static file server works:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## Deploy

### GitHub Pages (automatic)

Pushing to `main` triggers `.github/workflows/deploy.yml`, which publishes the
site to GitHub Pages. One-time setup in the repo settings:
**Settings → Pages → Source → GitHub Actions**.

### Cloud Run

```bash
gcloud run deploy blacksite --source . --region us-central1 --allow-unauthenticated
```

The included `Dockerfile` serves the game with nginx on port 8080.

## Architecture

| File | Purpose |
|---|---|
| `src/main.js` | Renderer, game loop, level/state management, HUD |
| `src/world.js` | Procedural level gen (rooms + corridors), collision, LOS, lighting |
| `src/player.js` | FPS controller: pointer lock + WASD, twin-zone touch controls |
| `src/enemies.js` | Soldier AI (patrol / chase / shoot), animation, damage |
| `src/weapons.js` | Viewmodel, hitscan ballistics, muzzle flash, impact FX |
| `src/textures.js` | Procedural canvas textures (concrete, metal, crates) |
| `src/audio.js` | Procedural WebAudio SFX (gunshots, reload, pickups, ambience) |

No bundler, no dependencies to install — the only "asset" is the vendored
`three.module.js`.
