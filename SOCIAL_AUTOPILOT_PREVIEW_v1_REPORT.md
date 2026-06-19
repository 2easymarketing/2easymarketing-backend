# 2EasyMarketing Social Autopilot Preview v1

This ZIP is a preview build only. Do not publish it until you test it.

## What was added

1. Social Autopilot preview under the existing Content Calendar area.
2. Brand Kit form for each client.
3. Free built-in 30-day content plan generator.
4. Approval queue with statuses:
   - queued_review
   - approved
   - rejected
   - ready_to_publish
5. CSV export for generated posts.
6. No auto-publishing yet. This is safe preview mode.

## What this makes possible

- Generate 30 days of post ideas/captions without paid APIs.
- Review posts before anything goes out.
- Approve or reject posts.
- Export captions to CSV.
- Build the foundation for real social media publishing APIs later.

## New backend routes

- GET /api/autopilot/status
- GET /api/autopilot/brand-kit
- POST /api/autopilot/brand-kit
- POST /api/autopilot/generate-plan
- GET /api/autopilot/posts
- POST /api/autopilot/posts/{post_id}/approve
- POST /api/autopilot/posts/{post_id}/reject
- POST /api/autopilot/posts/{post_id}/ready
- GET /api/autopilot/export.csv

## Files changed

- Removed old build-note files: MEDIA_FACTORY_VALIDATION_REPORT.txt, MEDIA_FACTORY_VERIFIED_REPORT.md
- Added backend Social Autopilot API routes and tables
- Checked server.py syntax: PASS
- Replaced static Content Calendar with Social Autopilot preview UI
- Updated Content Calendar header/button to Social Autopilot preview
- Checked portal.js feature hooks: PASS

## Next phase after this preview

1. Add editable post cards.
2. Add drag-and-drop calendar scheduling.
3. Add platform-specific formatting rules.
4. Add client approval comments.
5. Add real social account OAuth.
6. Add real publish queue.

## Important

This does not publish anything to social media yet. That is intentional.
