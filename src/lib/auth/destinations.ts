import { intervalFromSelection,uuidPattern } from '../domain';

export type VisitSelection = {resource:string;date:string;hour:number;duration:number};
export function visitSelection(params:URLSearchParams):VisitSelection|null {
  if ([...params.keys()].length !== 4 || ['resource','date','hour','duration'].some((key) => params.getAll(key).length !== 1)) return null;
  const resource = params.get('resource') || '';const date = params.get('date') || '';
  const hour = Number(params.get('hour'));const duration = Number(params.get('duration'));
  if (!uuidPattern.test(resource) || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || !/^\d{1,2}$/.test(params.get('hour') || '') || !/^\d{1,2}$/.test(params.get('duration') || '')) return null;
  try {intervalFromSelection(date,hour,duration);} catch {return null;}
  return {resource,date,hour,duration};
}
export function visitDestination(selection:VisitSelection) {
  return `/booking/review?${new URLSearchParams({resource:selection.resource,date:selection.date,hour:String(selection.hour),duration:String(selection.duration)})}`;
}
export function editVisitDestination(selection:VisitSelection) {
  return `/${visitDestination(selection).slice('/booking/review'.length)}#plan`;
}
export function safeDestination(value:unknown):string|null {
  if (typeof value !== 'string' || value.length > 500 || value !== value.trim() || !value.startsWith('/')
      || value.startsWith('//') || value.includes('\\') || [...value].some((c) => c.charCodeAt(0) <= 32 || c.charCodeAt(0) === 127)) return null;
  const url = new URL(value,'https://application.invalid');
  if (url.origin !== 'https://application.invalid' || url.hash || value.split('?')[0] !== url.pathname) return null;
  if ((url.pathname === '/' || url.pathname === '/account') && !url.search) return url.pathname;
  if(['/admin','/admin/bookings','/admin/spaces','/admin/availability','/admin/recovery','/admin/audit','/admin/refund-assistance'].includes(url.pathname)&&!url.search) return url.pathname;
  if(/^\/admin\/bookings\/[0-9a-f-]+$/i.test(url.pathname)&&uuidPattern.test(url.pathname.slice('/admin/bookings/'.length))&&!url.search) return url.pathname;
  if(/^\/booking\/[0-9a-f-]+$/i.test(url.pathname) && uuidPattern.test(url.pathname.slice('/booking/'.length)) && !url.search) return url.pathname;
  if (url.pathname !== '/booking/review') return null;
  const selection = visitSelection(url.searchParams);
  return selection ? visitDestination(selection) : null;
}
