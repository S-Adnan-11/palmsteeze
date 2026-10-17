# PalmSteeze Brand Kit v2 and image provenance

The owner approved Brand Kit v2 on 5 October 2026. The current application uses its curved workspace signature as primary, the upright stacked signature on the sign-in composition, and the optical simplified mark for small icons. The earlier standalone palm remains a historical source asset and is unused.

Selected SVG/PNG assets in `public/brand/v2/` are copied from the owner-supplied kit: primary forest/ivory horizontal logos, primary symbol, upright stacked logo, small mark, favicon/touch icon and Open Graph artwork. Vector art, icons and the kit's identity were authored for PalmSteeze according to the kit README. No trademark-clearance claim is made.

The kit supplies Manrope for UI, DM Serif Display for editorial emphasis, and Noto Sans scoped to U+20A6 for the naira glyph. Fonts are self-hosted in `public/fonts/`; their complete upstream OFL notices accompany them. No remote font service is used. Upstream sources:
- https://github.com/google/fonts/tree/main/ofl/manrope
- https://github.com/google/fonts/tree/main/ofl/dmserifdisplay
- https://github.com/google/fonts/tree/main/ofl/notosans

Six independent architectural images were generated on 5 October 2026 with the built-in image_gen tool under the imagegen skill, using existing generation access. They depict an imagined venue, never a real operator. Alt text and the footer explicitly identify them as generated impressions. No stock photograph or purchased asset was used.

| Asset | Scene |
|---|---|
| `public/spaces/hero.webp` | Double-height arched-window studio |
| `public/spaces/open-studio.webp` | Shared walnut desks and rectangular windows |
| `public/spaces/quiet-studio.webp` | Individual desk niches with timber screens |
| `public/spaces/cove.webp` | Intimate round-table meeting room |
| `public/spaces/grove.webp` | Six-seat oval-table meeting room |
| `public/spaces/canopy.webp` | Ten-seat conference-room impression |

Generated interiors are illustrative and do not establish a physical venue, measured furniture count or amenity evidence. Actual bookable capacity always comes from the application catalogue. All source images were 1536×1024 PNG. Project copies were encoded as WebP at quality 86 with the existing Sharp dependency; no scene content was edited. Raw originals remain in the ignored extracted-kit working folder and the tool's generation directory.

Exact generation prompts and transformation settings are recorded in `public/spaces/provenance.json`. No reference photographs, real identities or provider records were supplied to generation. Public synthetic data remains separate in `src/lib/demo-data.ts`, using reserved .example addresses and DEMO identifiers.

The narrowly adapted Uiverse component and exact MIT notice are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). No new production or animation dependency was installed.

8 October 2026 M4 continuation reuses hero.webp for arrival, quiet-studio.webp for settling at a desk and grove.webp for gathering. No new asset generation, source edit or provenance change occurred. The shared accessible selector dependency and exact MIT notice are recorded in THIRD_PARTY_NOTICES.md; motion remains native scroll/RAF and CSS.
11 October 2026: the owner chose Anime.js for the rebuilt single-stage workspace story. `animejs@4.5.0` is pinned with its lockfile; its MIT licence is included in the installed package (`node_modules/animejs/LICENSE.md`), copyright Julian Garnier. Official source: https://github.com/juliangarnier/anime. Timeline/onScroll API: https://animejs.com/documentation/events/onscroll/. Existing approved images and their provenance remain unchanged. This supersedes the earlier native-motion implementation notes above.

# Original WebGL workspace — 13 October 2026

The workspace animation now uses `three@0.186.1` and the existing `animejs@4.5.0`, with exact versions in the lockfile. Development definitions are pinned to `@types/three@0.186.0`. Three.js is MIT, copyright 2010–2026 three.js authors; Anime.js is MIT, copyright 2025 Julian Garnier. Full installed notices are retained in `public/licenses/three-MIT.txt` and `public/licenses/animejs-MIT.txt`. Primary references: https://threejs.org/docs/pages/WebGLRenderer.html and https://animejs.com/documentation/timeline/timeline-methods/seek/ .

`src/components/workspace-scene.ts` authors the room, furniture, upholstery, palms, outdoor silhouettes, timber grain, surface textures and leaf veins procedurally. No downloaded model, environment map, stock image, AI raster or copied scene is used. The companion SVG poster `public/art/workspace-breathe-poster.svg` is original code-built illustration. This fictional room is visual interpretation, not capacity, amenity or real-venue evidence. The existing architectural images remain in their approved surrounding sections with their original provenance.

This timed 12-second camera scene supersedes the 11 October image/scroll dissolve only. Its old controller, image layers, sticky travel and corresponding scoped styles are removed. Historical proof scripts and captures remain historical; current checks and unique recordings use `scripts/m4-webgl-review.cjs` and `tests/browser/workspace-story.ts`. M4 visual acceptance remains open; M5 stays paused.

# Google sign-in presentation — 9 October 2026

`public/auth/google-g.png` is Google's current unmodified gradient G, downloaded from https://developers.google.com/static/identity/images/g-logo.png, linked by https://developers.google.com/identity/branding-guidelines (page updated 7 July 2026; retrieved 9 October 2026). SHA-256: `d1ce9c2af0b10a7333abc99bc706f9a6a199e5b65bf3e3009624f076b8638e6a`. Google brand features remain Google's trademarks and are used under its Sign in with Google branding guidelines / https://about.google/brand-resource-center/guidance/; they are not licensed as PalmSteeze artwork or under MIT.

The shared Supabase sign-in button follows the official light treatment: white, #747775 inside stroke, #1F1F1F Google Sans Medium 14/20, 20px undistorted logo, 10px logo/text gap, at least 12px horizontal padding and a 48px touch target. No decorative arrow, identity SDK or authentication migration was added.

`public/fonts/google-sans-medium-latin.woff2` is the official Google Fonts 500 Latin subset, fetched through https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&display=swap (modern Chrome user-agent), hosted locally. Resource: https://fonts.gstatic.com/s/googlesans/v71/4Ua_rENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RFD48TE63OOYKtrw2IJllpyk.woff2 . SHA-256: `7ee2b232de66f7530be28964818bc8a813e62553138e48bffd917e95b19bd7fa`. SIL OFL 1.1, Copyright 2025 The Google Sans Project Authors (https://github.com/googlefonts/googlesans). Exact licence retained in `public/fonts/google-sans-OFL.txt`, sourced from https://github.com/google/fonts/blob/main/ofl/googlesans/OFL.txt . Used only for the Google button; approved PalmSteeze typography remains.


## Offline workspace video playback — 16 October 2026

The public workspace section now plays self-hosted, silent H.264 MP4s from `public/art/workspace-video/`. Desktop (1600×736), compact/tablet (1200×744) and mobile (704×864) are separate renders of the same approved scene, with its existing aspect-dependent camera FOV. Each 12-second asset contains 360 distinct independently rendered frames at 30 fps. The matching WebP posters are original scene renders at 4.5 seconds. No scene recording, frame duplication, downloaded model, generated image or new visual design was used.

The original room, procedural textures, lighting, postprocessing, camera path/gaze, leaf closure, palms and dust remain authored in `src/components/workspace-scene.ts`. Three.js and Anime.js remain licensed dependencies for offline export; the public section has no scene import and creates no WebGL context. Earlier WebGL implementation/evidence below is historical and preserved. Export uses `scripts/export-workspace-video.cjs`: exact `index * 1000 / 30` millisecond timeline seeks, fixed render dimensions, GPU completion/readback and per-frame SHA-256 records. `scripts/inspect-workspace-video.cjs` independently decodes the MP4s, verifies frame count/timestamps/fast-start atoms, compares source quality, and produces seam/full-loop contact sheets.

Local evidence and review: `docs/evidence/m4-video-20261016T100554-03095170/`. Browser recording artifacts demonstrate playback separately and are not source assets. MP4 encoding uses local FFmpeg 9.0.2 / libx264, High profile, yuv420p, CRF 19, no audio and `+faststart`. FFmpeg is an ignored development tool, not a shipped runtime. Technical references: [Anime timeline seeking](https://animejs.com/documentation/timeline/timeline-methods/seek/), [FFmpeg MP4 fast-start](https://ffmpeg.org/ffmpeg-formats.html#mov_002c-mp4_002c-ismv), [decoded browser-frame callbacks](https://developer.mozilla.org/en-US/docs/Web/API/HTMLVideoElement/requestVideoFrameCallback).

M4 stays open for owner review; M5 publication remains paused. No public deployment or provider/schema change.


## Workspace video owner acceptance ? 16 October 2026

The owner accepted the existing video conversion and selected silent inline autoplay without a custom playback button or native controls. The three approved MP4s and matching posters remain byte-identical; original scene/export source and earlier evidence are retained. Reduced motion keeps the poster; visibility suspends/resumes playback, and a rejected autoplay attempt remains a quiet poster for that mounted section. The pause-mechanism accessibility tradeoff is documented in docs/evidence/m4-video-controls-20261016T114326-ba3d9438/review.md; no full accessibility compliance is claimed. This accepts the workspace section only. Remaining M4 checks are unchanged and M5 publication remains paused.

## Decorative social placeholders — 17 October 2026

Instagram, Facebook, X and YouTube paths from [Simple Icons](https://github.com/simple-icons/simple-icons/tree/4d29a35c954699b389a834aacc97dd6e7e74143c/icons), pinned revision 4d29a35c954699b389a834aacc97dd6e7e74143c. CC0 1.0 Universal notice retained in public/licenses/simple-icons-CC0.txt. Names and marks remain their owners’ trademarks; no endorsement or active social profiles are implied. Rendered as noninteractive, assistive-technology-hidden decoration with no personal-account links.
