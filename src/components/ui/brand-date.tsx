'use client';
import {useEffect,useRef,useState} from 'react';
import * as Popover from '@radix-ui/react-popover';
import {UiIcon} from '@/components/ui-icon';
import {DayPicker,TZDate} from 'react-day-picker';
import {bookingDateRange,eligibleHours} from '@/lib/booking-options';
import {lagosDate,type VenueSettings} from '@/lib/domain';
import {dateOnly,dateEntry,parseDateEntry,formatVisitDate} from '@/lib/visit-dates';
import {brandPopupPosition,useBrandPopup} from '@/components/ui/use-brand-popup';

export function BrandDate({value,onChange,disabled,settings}:{value:string;onChange:(date:string)=>void;disabled?:boolean;settings:VenueSettings}) {
  const [open,setOpen]=useState(false);const [draft,setDraft]=useState('');const [error,setError]=useState('');
  const [content,setContent]=useState<HTMLDivElement|null>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  const popup=useBrandPopup(open,content,trigger);
  useEffect(()=>{if(disabled)setOpen(false);},[disabled]);
  const now=new Date();const range=bookingDateRange(settings,now);
  const zoned=(day:string)=>new TZDate(day+'T12:00:00+01:00','Africa/Lagos');
  // DayPicker asks about each day several times. This render's rules and clock
  // are fixed; a fresh map on every render preserves their existing freshness.
  const eligibility=new Map<string,boolean>();
  const eligible=(day:string)=>{
    if(eligibility.has(day))return eligibility.get(day)!;
    const value=Boolean(dateOnly(day)&&eligibleHours(day,settings,now).length);
    eligibility.set(day,value);return value;
  };
  const selected=dateOnly(value)?zoned(value):undefined;
  const [month,setMonth]=useState<Date|undefined>(undefined);
  function changeOpen(next:boolean) {
    if(next) {setDraft(dateEntry(value));setError('');setMonth(zoned(value>=range.min&&value<=range.max?value:range.min));}
    else popup.release();
    setOpen(next);
  }
  function commit(day:string) {
    if(!eligible(day)) {setError('Choose an open day from '+formatVisitDate(range.min)+' to '+formatVisitDate(range.max)+'.');return;}
    onChange(day);changeOpen(false);
  }
  return <Popover.Root modal open={open} onOpenChange={changeOpen}>
    <Popover.Trigger ref={trigger} id="date" className="brand-select-trigger brand-date-trigger" disabled={disabled} aria-label="Date" aria-describedby="date-help" data-value={value}>
      <span>{formatVisitDate(value)}</span><UiIcon name="calendar"/>
    </Popover.Trigger>
    <Popover.Portal><Popover.Content ref={setContent} className="brand-popup brand-calendar" {...brandPopupPosition} aria-labelledby="calendar-title" aria-describedby="calendar-help" onOpenAutoFocus={event=>{event.preventDefault();const panel=event.target as HTMLElement;requestAnimationFrame(()=>(panel.querySelector<HTMLButtonElement>('.rdp-selected button')||panel.querySelector<HTMLButtonElement>('.rdp-day_button:not(:disabled)'))?.focus({preventScroll:true}));}} onCloseAutoFocus={popup.onCloseAutoFocus}>
      <div className="calendar-heading"><strong id="calendar-title">Choose a visit date</strong><Popover.Close className="calendar-close" aria-label="Close calendar"><UiIcon name="close"/></Popover.Close></div>
      <p id="calendar-help">Lagos dates · next {settings.horizon_days} days</p>
      <DayPicker mode="single" required selected={selected} timeZone="Africa/Lagos" today={zoned(range.min)} month={month} onMonthChange={setMonth} startMonth={zoned(range.min)} endMonth={zoned(range.max)} weekStartsOn={1} navLayout="after" components={{Chevron:({orientation})=><UiIcon name={'chevron-'+(orientation||'right')}/>}} disabled={day=>!eligible(lagosDate(day))} onSelect={day=>{if(day) commit(lagosDate(day));}} labels={{labelDayButton:day=>formatVisitDate(lagosDate(day))}}/>
      <div className="calendar-entry"><label htmlFor="date-entry">Enter date · DD/MM/YYYY</label><div><input id="date-entry" type="text" inputMode="text" autoComplete="off" placeholder="09/10/2026" maxLength={10} value={draft} onChange={event=>{setDraft(event.target.value);setError('');}} aria-invalid={Boolean(error)} aria-describedby="date-entry-error" onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();const day=parseDateEntry(draft);if(day)commit(day);else setError('Enter a valid date as DD/MM/YYYY, for example 09/10/2026.');}}}/><button type="button" className="button" onClick={()=>{const day=parseDateEntry(draft);if(day)commit(day);else setError('Enter a valid date as DD/MM/YYYY, for example 09/10/2026.');}}>Use date</button></div><p id="date-entry-error" className="calendar-error" role="status">{error}</p></div>
    </Popover.Content></Popover.Portal>
  </Popover.Root>;
}
