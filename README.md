# Roadster Loop

A 3D nighttime ramp-stunt racing game for the browser. Wait for the green light, launch an electric roadster down the runway, climb the loop, hit the curved ramp, rotate in the air and stick the landing.

Plain HTML, CSS and JavaScript with Three.js loaded from a CDN. No build step, no dependencies to install.

> Unofficial fan game, not affiliated with Tesla.

## Files

```
roadster-loop/
├── index.html    page structure, HUD, menus
├── style.css     dark theme, neon green/blue, responsive layout
├── game.js       physics, 3D scene, audio, input, UI
├── vercel.json   static hosting config (clean URLs, cache and security headers)
└── README.md
```

## Controls

| Input | Action |
|---|---|
| Space | Launch on green (pressing earlier is "Too Early"). Also restarts after a result. |
| Left arrow | Rotate nose up in the air |
| Right arrow | Rotate nose down in the air |
| R | Restart |
| M | Mute / unmute |
| On-screen buttons | Same controls on phones and tablets |

Space has a 0.4 second lock after every press to stop key mashing.

## How a run scores

- Reaction time sets launch speed: the faster you react (under 0.6 s), the faster the car.
- Distance: 10 points per metre if you land, 4 per metre if you crash.
- Air time: 150 points per second.
- Flips: 750 points per full rotation, only if you land.
- Reaction bonus: up to 1500 points.
- Landing bonus: Perfect 1500, Clean 800, Rough 300.
- Landing succeeds when the car is within about 24 degrees of level with wheels down. Anything else is a crash.

## Run locally

Because the page loads Three.js from a CDN, you need an internet connection. Opening `index.html` directly works in most browsers. If yours blocks it, serve the folder:

```bash
cd roadster-loop
python3 -m http.server 8080
# open http://localhost:8080
```

## Deploy on Vercel

### Option A: Vercel dashboard (no tools needed)

1. Create a free account at https://vercel.com.
2. Push this folder to a GitHub, GitLab or Bitbucket repository.
3. In Vercel choose **Add New → Project** and import the repository.
4. Leave **Framework Preset** as **Other**. Leave Build Command and Output Directory empty.
5. Click **Deploy**. Your game is live at the URL Vercel shows.

### Option B: Vercel CLI

```bash
npm i -g vercel
cd roadster-loop
vercel          # follow the prompts, accept the defaults
vercel --prod   # publish to production
```

When asked, answer "No" to overriding build settings. The project is static, so there is nothing to build.

## Tuning

All gameplay constants are in the `C` object at the top of `game.js`: loop radius, ramp angle, acceleration, air rotation speed, landing tolerance (`LAND_TOL`, in radians) and the launch lock (`LOCK`).

## Notes

- Needs a browser with WebGL and WebAudio (any current Chrome, Edge, Firefox or Safari). Sound starts after you press Start game.
- Three.js r128 is loaded from cdnjs and fonts from Google Fonts. The game falls back to system fonts if the font request fails.
- Your best score is stored in the browser's localStorage.
