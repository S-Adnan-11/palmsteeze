export type ResourceKind = 'open_desk' | 'quiet_desk' | 'room';
export type Resource = { id: string; code: string; name: string; kind: ResourceKind; seats: number; description: string; hourly_kobo: number };
export type VenueSettings = {
  name: string; district: string; timezone: string; currency: string;
  opens_hour: number; closes_hour: number; open_weekdays: number[];
  horizon_days: number; lead_hours: number; deposit_percent: number; hold_minutes: number;
  defaults_proposed: boolean;checkout_minutes:number;
};
export type Quote = {
  resource_id: string; starts_at: string; ends_at: string; duration_hours: number;
  hourly_kobo: number; total_kobo: number; deposit_percent: number; deposit_kobo: number; balance_kobo: number;
};
export const workingDefaults: VenueSettings = {
  name: 'PalmSteeze Workspaces', district: 'Agege, Lagos', timezone: 'Africa/Lagos', currency: 'NGN',
  opens_hour: 8, closes_hour: 20, open_weekdays: [1,2,3,4,5,6], horizon_days: 30,
  lead_hours: 1, deposit_percent: 40, hold_minutes: 30, defaults_proposed: true,checkout_minutes:35,
};
export function formatMoney(kobo: number) {
  if (!Number.isSafeInteger(kobo) || kobo < 0) throw new Error('Invalid integer kobo');
  return new Intl.NumberFormat('en-NG',{style:'currency',currency:'NGN',maximumFractionDigits:kobo % 100 ? 2 : 0}).format(kobo / 100);
}
// Decimal text is converted with integer arithmetic, never floating-point money.
export function parseNaira(value:string) {
  if(!/^\d+(?:\.\d{1,2})?$/.test(value)) throw new Error('Enter naira with at most two decimal places.');
  const [whole,fraction='']=value.split('.');const amount=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
  if(amount>BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Amount exceeds the supported limit.');
  return Number(amount);
}
export function workingQuote(hourlyKobo: number, hours: number, percent: number) {
  if (![hourlyKobo,hours,percent].every(Number.isSafeInteger) || hourlyKobo < 1 || hours < 1 || hours > 23 || percent < 1 || percent > 100) {
    throw new Error('Invalid quote inputs');
  }
  const total = BigInt(hourlyKobo) * BigInt(hours);
  const deposit = (total * BigInt(percent) + 50n) / 100n; // integer half-up, to the nearest kobo
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Quote exceeds safe amount');
  return {total_kobo:Number(total),deposit_kobo:Number(deposit),balance_kobo:Number(total-deposit)};
}
const lagosCalendarDate = new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit'});
export function lagosDate(now: Date) {
  return lagosCalendarDate.format(now);
}
export function initialBookingDate(now = new Date()) {
  const candidate = new Date(now.getTime() + 86400000);
  while (new Date(`${lagosDate(candidate)}T12:00:00+01:00`).getUTCDay() === 0) candidate.setUTCDate(candidate.getUTCDate()+1);
  return lagosDate(candidate);
}
export function intervalFromSelection(date: string, startHour: number, duration: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(startHour) || !Number.isInteger(duration)
    || startHour < 0 || startHour > 23 || duration < 1 || startHour + duration > 23) throw new Error('Choose a valid date and time.');
  const start = new Date(`${date}T${String(startHour).padStart(2,'0')}:00:00+01:00`);
  if (!Number.isFinite(start.getTime()) || lagosDate(start) !== date) throw new Error('Choose a valid date.');
  return {starts_at:start.toISOString(),ends_at:new Date(start.getTime()+duration*3600000).toISOString()};
}
export function validateInterval(start: unknown, end: unknown, settings: VenueSettings, now = new Date()) {
  const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
  if (typeof start !== 'string' || typeof end !== 'string' || !iso.test(start) || !iso.test(end)) throw new Error('Use explicit ISO timestamps.');
  const s = new Date(start); const e = new Date(end);
  const localS = new Date(s.getTime()+3600000); const localE = new Date(e.getTime()+3600000);
  if (![s.getTime(),e.getTime()].every(Number.isFinite) || e <= s || e.getTime()-s.getTime() < 3600000
    || localS.toISOString().slice(0,10) !== localE.toISOString().slice(0,10)
    || s.getUTCMinutes() || s.getUTCSeconds() || s.getUTCMilliseconds() || e.getUTCMinutes() || e.getUTCSeconds() || e.getUTCMilliseconds()
    || !settings.open_weekdays.includes(localS.getUTCDay()) || localS.getUTCHours() < settings.opens_hour || localE.getUTCHours() > settings.closes_hour
    || s.getTime() < now.getTime()+settings.lead_hours*3600000
    || lagosDate(s) > lagosDate(new Date(now.getTime()+settings.horizon_days*86400000))) throw new Error('Choose whole hours within opening hours and the booking horizon.');
  return {starts_at:s.toISOString(),ends_at:e.toISOString()};
}
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function exactObject(value: unknown, keys: string[]): asserts value is Record<string,string> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length
    || keys.some((key) => typeof (value as Record<string,unknown>)[key] !== 'string')) throw new Error('Request contains missing or unsupported fields.');
}
