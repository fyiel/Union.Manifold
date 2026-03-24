# Lessons

- When validating Electron auto-updates on Windows, check `build.win.publisherName` before debugging downloader errors. Leaving it set causes unsigned installers to fail signature validation even if `latest.yml` and asset names are correct.