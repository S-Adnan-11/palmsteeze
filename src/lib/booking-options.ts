import {intervalFromSelection,lagosDate,validateInterval,type VenueSettings} from './domain';
export type HourSlot={hour:number;available:boolean};

export function bookingDateRange(settings:VenueSettings,now=new Date()) {
  return {min:lagosDate(now),max:lagosDate(new Date(now.getTime()+settings.horizon_days*86400000))};
}
// Eligible whole hours; provider availability is a separate, fresh read.
export function eligibleHours(date:string,settings:VenueSettings,now=new Date()) {
  const hours:number[]=[];
  for(let hour=settings.opens_hour;hour<settings.closes_hour;hour++) {
    try {const interval=intervalFromSelection(date,hour,1);validateInterval(interval.starts_at,interval.ends_at,settings,now);hours.push(hour);} catch { /* Closed, too soon or outside the horizon. */ }
  }
  return hours;
}
export function contiguousDurations(hour:number,slots:HourSlot[]) {
  const values:number[]=[];
  while(slots.find(s=>s.hour===hour+values.length)?.available) values.push(values.length+1);
  return values;
}
