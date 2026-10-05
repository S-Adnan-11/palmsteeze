import type {Metadata} from 'next';
import {AdminPreview} from '@/components/admin-preview';
export const metadata:Metadata={title:'Synthetic admin preview · PalmSteeze',description:'Read-only administration illustration using fictitious data. No customer records or payment actions.'};
export default function Preview() {return <AdminPreview/>;}
