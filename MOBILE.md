# Mobile App Setup

This repo is configured with Capacitor so the same React/Vite app can be used as:

- a web app with `npm run dev` or `npm run build`
- an Android app from the `android/` native project
- an iOS app from the `ios/` native project

## Common Commands

Build the web app and sync both native projects:

```bash
npm run mobile:sync
```

Open Android Studio:

```bash
npm run mobile:android
```

Open Xcode:

```bash
npm run mobile:ios
```

## Notes

- Capacitor uses the Vite `dist/` output as the mobile app payload.
- Android builds require Android Studio and an Android SDK.
- iOS builds require Xcode. If Xcode reports a license error, run `sudo xcodebuild -license` in Terminal and review/accept the license.
- iOS native dependency installation also requires CocoaPods.
