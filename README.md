# iHome

An iPhone app to control smart lights from different brands in one place, with
dynamic (animated) scenes such as Halloween looks.

Built with Expo (React Native) and TypeScript. It needs a **development build**
(not Expo Go) because it includes native Swift code.

## Status

| Area | Status |
| --- | --- |
| Philips Hue (local CLIP v2 API) | ✅ Pairing, lights by room, on/off, brightness, colour, white temperature, live updates, bridge scenes incl. dynamic playback |
| Govee (LAN API) | Planned (phase 3) |
| Apple Home / HomeKit (for IKEA and other Matter lights) | Planned (phase 4) |
| Cross-brand dynamic scene engine + Halloween presets | Planned (phase 6) |

### Halloween scenes today

Add any of Hue's Halloween scenes from the scene gallery in the Hue app. They then
show up under **Scenes** in iHome with a **▶ Dynamic** button. Dynamic playback runs on
the bridge, so it keeps going after you close iHome.

## Running it on your iPhone

You need a Mac with Xcode, or EAS Build (builds in the cloud).

```bash
npm install

# Option A: Mac with Xcode, phone plugged in
npx expo run:ios --device

# Option B: cloud build, then install via the QR code EAS gives you
npx eas-cli@latest build --profile development --platform ios
npx expo start --dev-client
```

When the app first talks to the bridge, iOS asks for **Local Network** access. Allow it.

## How it works

```
src/app/            screens (Expo Router)
src/core/           device model and colour math (RGB / HSV / CIE xy / kelvin)
src/drivers/        one driver per brand, all implementing src/drivers/Driver.ts
  hue/              CLIP v2 client, pairing, event stream, mapping
src/registry/       merges all drivers into one device list and routes commands
src/store/          app state (zustand); bridge keys in the iOS Keychain
modules/hue-http/   Swift module: HTTPS to the bridge with certificate pinning, SSE stream
```

The Hue bridge uses a certificate signed by Signify's own CA, which iOS doesn't trust.
The `hue-http` module checks that the certificate is issued for the bridge ID, then pins
its SHA-256 fingerprint at pairing and refuses any other certificate afterwards.

## Development

```bash
npm test           # unit tests (colour math, Hue driver against an in-memory fake bridge, registry)
npm run typecheck
npm run lint
```
