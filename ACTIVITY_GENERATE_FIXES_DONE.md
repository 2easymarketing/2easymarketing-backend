# Activity / Generate Fixes Done

This build fixes Generate buttons that were not producing output.

## Fixed

- Client Reports Generate buttons now call `/api/owner/generate-report` and display the report.
- Reports are saved into Autonomous Tasks.
- AI Ad Engine Generate now returns a valid fallback campaign if Anthropic is missing/fails.
- Media Factory image/video/voiceover generation now creates review fallback briefs instead of silent errors.

## Still needed for full live AI

- Add `ANTHROPIC_API_KEY` in Railway for full AI writing.
- Add `PPLX_API_KEY` in Railway for live competitor/trend intelligence.
- Configure media provider/CLI for real generated image/video/audio files.

## Changed

- server.py: patched Ad Engine Generate fallback
- server.py: added /api/owner/generate-report
- server.py: added media fallback helper
- server.py: media generate now creates review fallback instead of error
- portal.js: report Generate buttons now call backend and display report
