# andrewgerstenslager.com

Personal site of Andrew Gerstenslager, built as a retro-futuristic mission-control screen. A glowing amber wireframe globe sits at the centre of a live HUD: a telemetry rail (angular velocity, facing coordinates, zoom, frame rate), a system log that records real events, and UTC / mission-elapsed clocks. Four command buttons open files (About, Portfolio, Demos, Contact) in a panel. When a file opens, the globe glides aside and turns to lock onto that file's node. The Demos file includes a working **Globe Lab** that changes the globe on the page live.

Built with Vite, Tailwind CSS v4 and Three.js, in plain JavaScript ES modules.

## Getting started

```bash
npm install
npm run dev       # dev server with hot reload (http://localhost:5173)
npm run build     # production build into dist/
npm run preview   # serve the production build locally
```

## Editing your content

All personal content lives in **`src/content.js`**. It is the only file you need to edit.

- Every unknown field is written as `TODO('…')`. The site shows it as a hatched "awaiting data" placeholder labelled "— replace in src/content.js". Replace it with a plain string.
- Links, images, the portrait and the email address are `null` until you set them, and show as "PENDING".
- Put images and your résumé in `public/` and reference them with absolute paths, e.g. `'/portrait.jpg'`, `'/resume.pdf'`, `'/projects/op-01.jpg'` (16:9).
- `npm run dev` prints how many placeholder fields remain.

## Keyboard

| Key | Action |
|-----|--------|
| `1`–`4` | Open About / Portfolio / Demos / Contact |
| `[` `]` | Previous / next file (while a file is open) |
| `Esc` | Back out of a project detail, then close the file (also skips the boot sequence) |
| Arrows | Spin the globe (hold `Shift` for more), when the globe has keyboard focus |
| `+` / `−` | Zoom the globe, when focused |
| `R` or `0` | Reset the view, when focused (double-click / double-tap also resets) |

Files have real URLs (`/#about`, `/#portfolio/op-02`, `/#demos/sim-00`), so deep links and the browser Back button work.

## URL switches

- `?quality=high|medium|low` forces a render tier and turns off automatic downgrading.
- `?debug` exposes `window.__ag = { globe, ui }` in the console.

Without WebGL the site runs in a static mode (the globe is replaced by a still emblem, and everything else still works). With `prefers-reduced-motion` the boot sequence, idle spin and transitions are turned off.

## Deployment

Pushing to `master` runs `.github/workflows/deploy.yml`, which builds the site and deploys `dist/` to GitHub Pages. The custom domain is set in `public/CNAME`.

## Fonts and licences

- **Departure Mono** by Helena Zhang is self-hosted from `public/fonts/` under the SIL Open Font License 1.1 (`public/fonts/DepartureMono-OFL.txt`).
- **IBM Plex Mono** (panel body text) is loaded from Google Fonts under the SIL Open Font License 1.1.
