# Free Media Integration Options

Use these before paying for media providers.

## Stock Photos And Video

1. Pexels API
   - Best first choice for free photos and stock video.
   - Requires a free API key.
   - Add `PEXELS_API_KEY` when you wire backend search/download support.
   - Show Pexels attribution/link where search results are displayed.

2. Pixabay API
   - Good backup for photos, vectors, videos, music, and sound effects.
   - Requires a free API key.
   - Add `PIXABAY_API_KEY` when you wire backend search/download support.
   - Cache API responses and download images to your server instead of permanent hotlinking.

3. Unsplash API
   - Excellent photo source, but not video.
   - Requires an access key and attribution.
   - Add `UNSPLASH_ACCESS_KEY` only if you need a third photo source.

## AI Images

- Free production control: self-host Stable Diffusion or ComfyUI.
- Prototype option: Pollinations image endpoints, with graceful fallback if unavailable.

## Voiceover

- Browser preview: Web Speech API. This is already free and runs in the visitor's browser.
- Rendered audio files: self-host Coqui TTS or Piper on the backend.
- Paid services such as ElevenLabs are optional, not required for the free path.

## Suggested Rollout

1. Keep the current instant SVG/storyboard/browser-speech fallback so Media Factory never feels broken.
2. Add Pexels search/download for stock photo and video references.
3. Add Pixabay as a fallback source.
4. Add self-hosted Coqui TTS or Piper when you need real downloadable audio.
5. Add self-hosted ComfyUI only when the server/GPU budget is ready.
