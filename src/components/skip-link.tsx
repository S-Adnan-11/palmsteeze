'use client';

import Link from 'next/link';

export function SkipLink() {
  return <Link className="skip-link" href="#main" prefetch={false}
    onNavigate={() => requestAnimationFrame(() => document.getElementById('main')?.focus({preventScroll: true}))}>
    Skip to content
  </Link>;
}
