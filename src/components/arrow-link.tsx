import type {ReactNode} from 'react';
// Adapted from Adam Giebl's Uiverse new-bird-34, MIT.
// Exact source, copyright, permission and changes: THIRD_PARTY_NOTICES.md.
export function ArrowLink({href,children}:{href:string;children:ReactNode}) {
  return <a className="arrow-link" href={href}><span>{children}</span><span className="arrow-link-icon" aria-hidden="true">↗</span></a>;
}
