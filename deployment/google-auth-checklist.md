# Google authentication release checklist

Reviewed 18 October 2026. Google remains the only customer sign-in provider. Current application requests `openid email profile` through Supabase; Google secrets stay in Supabase. This checklist records account actions and evidence, not a claim that Google branding or public-audience verification is complete.

## Identify the existing client

- In Supabase Authentication → Sign In / Providers → Google, identify the configured Web client ID privately. Match it to Google Auth Platform → Clients in the owning Google Cloud project. Do not infer the project from a displayed app/widget name or put the client secret into application hosting.
- The Google client's authorized provider redirect must remain exactly `https://hjcntuysnzzkddpnulaa.supabase.co/auth/v1/callback`. The application's `https://palmsteeze.devs.surf/auth/callback` belongs in Supabase's redirect allowlist, not as a replacement Google provider callback.
- Supabase Site URL is the hosted origin. Preserve `http://localhost:3000/auth/callback` and `https://4fs16bjg-3000.euw.devtunnels.ms/auth/callback`, along with existing legitimate entries. A shared Supabase project means development and hosted journeys share identity configuration.

## Inspect Branding, Audience and Data Access

- Branding: use truthful PalmSteeze identity, the approved logo where permitted, operational support/developer contact `s.adnan.werk@gmail.com`, and the actual HTTPS homepage, `/privacy` and `/terms`. Record both Draft Branding and Published Branding; saving a draft does not publish it.
- Audience: record Internal/External, Testing/Published, intended users, tester restrictions and the observed consent experience. Public hosting does not change Google publishing status. Basic identity-only scopes have special testing rules; do not assume a tester restriction or unrestricted access without inspecting the actual configuration and account journey.
- Data Access: verify only the needed identity scopes. Brand review and sensitive/restricted-scope review are different processes; basic identity scopes do not justify adding broader Google API access.
- Verification: record the actual Branding/Verification Center status. For an external published app to display its verified name/logo, follow Verify Branding, resolve findings, then Publish branding. Record any personal/testing exception precisely; do not describe an exempt or unverified demo as brand-verified.

## Domains and development preservation

Google's domain checks can involve the registrable parent domain. Ownership of `palmsteeze.devs.surf` does not prove ownership of `devs.surf`, and Vercel's TXT verification does not establish Google Search Console ownership. Inspect the exact Google challenge; obtain the supported operator/Google resolution if parent ownership is requested. Do not claim the parent, invent verification, change the canonical website or purchase a domain.

Keep the existing free Supabase provider hostname. A paid Supabase Auth custom domain is not authorized. Users may see the Supabase hostname during Google sign-in; record that limitation rather than promising a branded auth hostname.

Google recommends separating public production and development OAuth projects/clients. Preserve functioning development access while the owner reviews the actual project, audience and verification requirements. Do not remove development entries, replace credentials or create another provider implicitly. A future OAuth-client separation needs a concrete compatibility plan for this shared Supabase project; it is not achieved by changing frontend links.

Ensure reviewers can reach the required product/legal information without an account. Legal pages already bypass entrance verification; record any homepage challenge issue raised by Google before changing the accepted entrance policy.

## Acceptance evidence

Use a normal browser to check start, cancel, retry, successful Google callback, saved selection, necessary-only preferences, sign-out, and localhost/tunnel continuity. Check a phone separately. Record the real consent name/domain/warnings without storing identities, authorization codes or tokens. Automated synthetic Auth and callback-cancellation checks do not establish Google consent success.

Sources: [Google app states](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview), [brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification), [production policies](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance), [Supabase Google setup](https://supabase.com/docs/guides/auth/social-login/auth-google).
