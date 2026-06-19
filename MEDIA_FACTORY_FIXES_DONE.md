# Media Factory Fixes Done

This build fixes the Media Factory buttons so clicking Generate immediately produces visible output.

## Fixed

- Image Ad Generate now returns an instant branded SVG image preview.
- Video Ad Generate now returns an instant branded video storyboard preview.
- Voiceover Generate now returns a voiceover script and a browser Speak Preview button.
- Results show immediately on the Media Factory page.
- Results are saved into tasks/media library with delivered status.
- Media cards have inline click fallback so they still open even if event binding fails.

## Important

This fixes the broken/non-responsive buttons with a fully free fallback path. For richer production media, start with free/low-friction integrations:

- Stock photos/video: Pexels API first, Pixabay API second.
- AI image prototypes: Pollinations, or self-hosted Stable Diffusion/ComfyUI for true free production control.
- Voice preview: browser Web Speech API.
- Rendered voice files: self-hosted Coqui TTS or Piper instead of a paid TTS API.

## Changed

- server.py: added instant /api/media-factory/generate endpoint
- index.html: added inline click fallback and instant result panel
- portal.js: Generate button now calls instant Media Factory endpoint and displays result
- portal.js: exposed selectMediaType fallback for cards
- portal.js: media library can display video storyboard and voiceover script results
