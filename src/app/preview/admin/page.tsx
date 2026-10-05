import type {Metadata} from 'next';
import {PublicHeader,SiteFooter} from '@/components/brand';
import {AdminPreview} from '@/components/admin-preview';
export const metadata:Metadata={title:'Synthetic admin preview · PalmSteeze',description:'Read-only administration illustration using fictitious data. No customer records or payment actions.'};
export default function Preview(){return <><PublicHeader/><main id="main" tabIndex={-1} className="preview-page"><div className="preview-notice"><strong>Synthetic administration preview</strong><span>Fictitious people and records · Read-only · No live financial operations</span></div><AdminPreview/></main><SiteFooter/></>;}
