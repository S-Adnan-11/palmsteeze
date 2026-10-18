import type {ReactNode} from 'react';
import Link from 'next/link';
// Adapted from Adam Giebl's Uiverse new-bird-34, MIT.
// Exact source, copyright, permission and changes: public/licenses/third-party-notices.txt.
export function ArrowLink({href,children}:{href:string;children:ReactNode}) {
  return <Link className="arrow-link" href={href} prefetch={false}><span>{children}</span><span className="arrow-link-icon" aria-hidden="true">↗</span></Link>;
}
