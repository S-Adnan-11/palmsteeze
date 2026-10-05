import type { Resource } from './domain';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
// Explicit preview fixtures. Never used to create a real allocation or assert live availability.
export const previewResources: Resource[] = [
  ...Array.from({length:16},(_,i) => ({id:id(i+1),code:`OPEN-${String(i+1).padStart(2,'0')}`,name:`Open desk ${String(i+1).padStart(2,'0')}`,kind:'open_desk' as const,seats:1,hourly_kobo:200000,description:'A bright shared workspace with room to think, reliable Wi-Fi and power.'})),
  ...Array.from({length:8},(_,i) => ({id:id(i+17),code:`QUIET-${String(i+1).padStart(2,'0')}`,name:`Quiet desk ${String(i+1).padStart(2,'0')}`,kind:'quiet_desk' as const,seats:1,hourly_kobo:250000,description:'A calmer corner for deep work, with a dedicated desk and fewer distractions.'})),
  {id:id(25),code:'COVE',name:'Cove',kind:'room',seats:4,hourly_kobo:800000,description:'A private room for small teams and good conversations.'},
  {id:id(26),code:'GROVE',name:'Grove',kind:'room',seats:6,hourly_kobo:1200000,description:'Bring the team together around one table.'},
  {id:id(27),code:'CANOPY',name:'Canopy',kind:'room',seats:10,hourly_kobo:2000000,description:'A generous whole room for workshops and bigger ideas.'},
];
