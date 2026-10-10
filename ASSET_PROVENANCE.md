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
# Google sign-in presentation — 9 October 2026

`public/auth/google-g.png` is Google's current unmodified gradient G, downloaded from https://developers.google.com/static/identity/images/g-logo.png, linked by https://developers.google.com/identity/branding-guidelines (page updated 7 July 2026; retrieved 9 October 2026). SHA-256: `d1ce9c2af0b10a7333abc99bc706f9a6a199e5b65bf3e3009624f076b8638e6a`. Google brand features remain Google's trademarks and are used under its Sign in with Google branding guidelines / https://about.google/brand-resource-center/guidance/; they are not licensed as PalmSteeze artwork or under MIT.

The shared Supabase sign-in button follows the official light treatment: white, #747775 inside stroke, #1F1F1F Google Sans Medium 14/20, 20px undistorted logo, 10px logo/text gap, at least 12px horizontal padding and a 48px touch target. No decorative arrow, identity SDK or authentication migration was added.

`public/fonts/google-sans-medium-latin.woff2` is the official Google Fonts 500 Latin subset, fetched through https://fonts.googleapis.com/css2?family=Google+Sans:wght@500&display=swap (modern Chrome user-agent), hosted locally. Resource: https://fonts.gstatic.com/s/googlesans/v71/4Ua_rENHsxJlGDuGo1OIlJfC6l_24rlCK1Yo_Iqcsih3SAyH6cAwhX9RFD48TE63OOYKtrw2IJllpyk.woff2 . SHA-256: `7ee2b232de66f7530be28964818bc8a813e62553138e48bffd917e95b19bd7fa`. SIL OFL 1.1, Copyright 2025 The Google Sans Project Authors (https://github.com/googlefonts/googlesans). Exact licence retained in `public/fonts/google-sans-OFL.txt`, sourced from https://github.com/google/fonts/blob/main/ofl/googlesans/OFL.txt . Used only for the Google button; approved PalmSteeze typography remains.

