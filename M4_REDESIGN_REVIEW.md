# PalmSteeze M4 redesign review

On 5 October 2026 the owner accepted the current visual direction **for progressing to M5**, after inspecting part of the redesign. This is partial owner review. It does not establish acceptance of every screen, physical devices or Safari. The unchecked items below carry into hosted-preview acceptance; M5 preparation is authorized, with a concrete readiness report required before first publication. The earlier M4 interface was not accepted.

Work is on `redesign/m4-brand-v2`, from verified pushed checkpoint `0e0becf` on `main`. No reset, force-push, paid service, live payment or publication was performed. The generated AGENTS.md's assertion that the branch had no commits was materially stale; it was checked against actual history and corrected locally. Old proposed-brand statements were updated without silently approving proposed venue hours/rates.

The homepage, space planner, sign-in, review/payment choices, customer visits and real administration now share the approved forest/ivory palette, logo family and typography. The real and synthetic admin use the same shell, overview, booking browser and refund presentation. The synthetic preview uses a static separate dataset, skips Auth refresh, and has no forms, record reads or mutation endpoints. Customer navigation prioritizes booking; **About this project** in the footer leads to the case study and preview.

Review locally at `http://localhost:3000`. Genuine administration remains restricted to the existing assigned account at `/admin`. No account setup or milestone acceptance is assumed from automated checks.

- [ ] Homepage: approve the composition, imagery, typography, spacing and prominent planner at desktop and phone widths.
- [ ] Booking: choose space/date/hours, check availability, review the authoritative naira quote, and compare minimum/higher/full initial payment. Check the invalid-amount disabled state and clear test-payment disclosure.
- [ ] Customer visits: review upcoming/history grouping, booking/payment/refund labels, cancellation history and expandable/copyable reference.
- [ ] Real admin: review overview density, today/next visit, collected-versus-booking-value figures, search/filter and the spaces/availability/recovery/audit views.
- [ ] Synthetic preview: inspect all six sections at `/preview/admin`; confirm its read-only labels and outstanding-reimbursement presentation are clear and match the real admin's design quality.
- [ ] Keyboard/mobile: confirm focus visibility, skip link, native controls, text legibility and stacked layouts. Reduced motion disables decorative motion.

Actual application captures use generated imagery and synthetic records. Authenticated captures use isolated test customers; real aggregate totals and signed-in identifiers are masked. They are application screenshots, not the kit's static references.

| View | Desktop | Mobile |
|---|---|---|
| Homepage | [Screenshot](docs/screenshots/m4-v2/home-desktop.png) | [Screenshot](docs/screenshots/m4-v2/home-mobile.png) |
| Real admin overview, filtered fixtures | [Screenshot](docs/screenshots/m4-v2/admin-real-overview-desktop.png) | [Screenshot](docs/screenshots/m4-v2/admin-real-overview-mobile.png) |
| Synthetic admin overview | [Screenshot](docs/screenshots/m4-v2/admin-preview-overview-desktop.png) | [Screenshot](docs/screenshots/m4-v2/admin-preview-overview-mobile.png) |
| Full-payment review | [Screenshot](docs/screenshots/m4-v2/payment-review-full-desktop.png) | [Screenshot](docs/screenshots/m4-v2/payment-review-full-mobile.png) |
| Customer visits | [Screenshot](docs/screenshots/m4-v2/customer-bookings-desktop.png) | [Screenshot](docs/screenshots/m4-v2/customer-bookings-mobile.png) |
| Invalid higher payment, disabled | [Screenshot](docs/screenshots/m4-v2/payment-invalid-disabled-desktop.png) | [Screenshot](docs/screenshots/m4-v2/payment-invalid-disabled-mobile.png) |
| Loading / disabled planner | [Screenshot](docs/screenshots/m4-v2/booking-loading-disabled-desktop.png) | [Screenshot](docs/screenshots/m4-v2/booking-loading-disabled-mobile.png) |
| Quote-service error | [Screenshot](docs/screenshots/m4-v2/booking-error-desktop.png) | [Screenshot](docs/screenshots/m4-v2/booking-error-mobile.png) |
| Empty customer account | [Screenshot](docs/screenshots/m4-v2/customer-empty-desktop.png) | [Screenshot](docs/screenshots/m4-v2/customer-empty-mobile.png) |
| Empty admin search | [Screenshot](docs/screenshots/m4-v2/admin-empty-search-desktop.png) | [Screenshot](docs/screenshots/m4-v2/admin-empty-search-mobile.png) |
| Failed refund / rejected replacement | [Screenshot](docs/screenshots/m4-v2/admin-preview-refunds-desktop.png) | [Screenshot](docs/screenshots/m4-v2/admin-preview-refunds-mobile.png) |

Validation passed: build/typecheck/lint, 11 units, 20 full browser regressions, four final visual/isolation checks and 33 database groups. The final read-only audit verifies preserved snapshots, zero test identities and the unchanged recovery schedule. Zero axe violations/overflow in tested capture states; 25 browser assets checked for six private credential values with no matches. [Detailed report](TEST_REPORT.md) and [verification record](docs/evidence/m4-v2/verification.json). Delayed read requests, quote HTTP 503 and unavailable inventory in the visual test are controlled browser faults. Actual hosted payments/refunds and database role/concurrency proofs are recorded separately. Chrome desktop/mobile emulation does not claim physical-device or Safari testing.

M1–M3 financial authority remains unchanged: integer kobo, historical 30% snapshots, new 40% minimum with higher/full initial payment, net-collected refund entitlement, serialized decisions, identity/audit history and recovery. The original failed replacement remains FAILED; the revised permanent-rejection handling does not imply reimbursement completed. The original evidence files are preserved.

[Assets and generation provenance](ASSET_PROVENANCE.md) · [Exact image prompts](public/spaces/provenance.json) · [Component/font attribution](THIRD_PARTY_NOTICES.md)
