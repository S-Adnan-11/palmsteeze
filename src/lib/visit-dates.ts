// A visit date is a Lagos calendar day, never the browser's local midnight.
export function dateOnly(value:string) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value?date:undefined;
}
export function formatVisitDate(value:string) {
  const date=dateOnly(value);
  return date?new Intl.DateTimeFormat('en-GB',{timeZone:'UTC',weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(date):'Choose a date';
}
export function dateEntry(value:string) {
  return dateOnly(value)?value.slice(8,10)+'/'+value.slice(5,7)+'/'+value.slice(0,4):'';
}
export function parseDateEntry(value:string) {
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  const date=match?match[3]+'-'+match[2]+'-'+match[1]:'';
  return dateOnly(date)?date:null;
}
export function formatWatDateTime(value:string) {
  const date=new Date(value);
  const day=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',weekday:'short',day:'numeric',month:'short',year:'numeric'}).format(date);
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(date);
  return day+' · '+time+' WAT';
}
export function formatWatVisitTime(startsAt:string,endsAt:string) {
  const time=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Lagos',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  return formatWatDateTime(startsAt).split(' · ')[0]+' · '+time.format(new Date(startsAt))+'–'+time.format(new Date(endsAt))+' WAT';
}
