# Plugin Hub Integrated Preview v1

This ZIP integrates the Plugin Hub front-end design into the real dashboard preview.

## What was added

1. New Plugin Hub dashboard view.
2. New Plugin Hub navigation item.
3. Backend safe plugin catalog route.
4. Backend plugin detail route.
5. Backend test route that checks Railway Variables.
6. Plugin cards for:
   - Instagram + Facebook
   - YouTube Shorts
   - TikTok Publisher
   - ElevenLabs Voiceover
   - Luma Video API
   - OpenAI Images
   - Email Engine
   - Approval Queue
   - CSV Export
7. Preview mode only: no real account connection and no auto-publishing yet.

## New backend routes

- GET /api/plugins/catalog
- GET /api/plugins/{slug}
- POST /api/plugins/{slug}/test

## Safety

Nothing publishes publicly.
No API keys are stored in the frontend.
The test button only checks whether required Railway Variables exist.

## Changed

- Added backend Plugin Hub preview catalog/test routes
- Checked server.py syntax: PASS
- Added Plugin Hub navigation button before nav close
- Added Plugin Hub dashboard view container
- Added Plugin Hub frontend JS
- Hooked Plugin Hub into existing view loader
- Checked portal.js Plugin Hub hooks: PASS
