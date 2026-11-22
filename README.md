# Vocalous

An open source web app that helps practice singing with pitch tracking, scoring, exercises, and optional local voice tools.

See `plans/singing-coach-roadmap.md` for the feature roadmap and `AGENT.md` for the DOX work contracts.

## Building
```bash
# Build wasm
# Prerequisite: cargo and wasm-pack
cd wasm
wasm-pack build --target web

# Build the visualization
cd ../display
npm install
npm run build

# Start the app
cd ../client
npm install
npm run start
```

Or from the repo root: `./run` (port 3000, base `/app/`).

### Optional sidecar (lyrics check / denoise)

```bash
cd backend
python server.py   # http://127.0.0.1:8765/health
```

See `backend/README.md`.

## Credits

This app is built on excellent [pitch detection app](https://alesgenova.github.io/pitch-detection-app/)
by Alessandro Genova and Jason Siefken.
