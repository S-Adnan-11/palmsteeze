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
