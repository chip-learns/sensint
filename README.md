# SENSINT — Sensitivity Intelligence

A free, open-source browser tool that finds your best mouse sensitivity by measuring how you aim, not how a setting feels. It then converts the result into ready-to-type settings for Escape from Tarkov, CS2 and Wardogs.

Existing finders run a feel-based "which of these two feels better?" search. That approach is noisy, fatigue skews it, and it never explains why a number suits you. SENSINT runs repeatable, seeded drills at blind candidate sensitivities and recommends a cm/360 based on your scores.

Everything runs in the browser: no install, no accounts, no server.

## Status

Phase 1a: pointer lock with raw input, the Flick drill, and session JSON export.

## Develop

```bash
npm install
npm run dev
npm test
```

Use Chrome or Edge. They support `unadjustedMovement` pointer lock, which reads raw mouse counts without OS acceleration. Sessions recorded without raw input are flagged.

## Adding a game

Add an entry to `data/games.json` with the game's yaw (degrees per mouse count at sensitivity 1) and a source link.

## License

MIT
