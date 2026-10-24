// Adapted from shadcn/ui Card, MIT (Copyright (c) 2023 shadcn).
// Source and complete licence: public/licenses/third-party-notices.txt.
import type {ComponentProps} from 'react';

export function Card({className='',...props}:ComponentProps<'div'>) {
  return <div data-slot="card" className={`foundation-card ${className}`} {...props}/>;
}
export function CardContent({className='',...props}:ComponentProps<'div'>) {
  return <div data-slot="card-content" className={`foundation-card-content ${className}`} {...props}/>;
}
