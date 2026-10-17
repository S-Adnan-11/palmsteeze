import {defineConfig} from '@playwright/test';
import base from './playwright.config';
export default defineConfig({...base,testMatch:['auth.spec.ts','entrance-booking.spec.ts'],use:{...base.use,launchOptions:{args:['--host-resolver-rules=MAP localhost 127.0.0.1']}},webServer:{...(base.webServer as {command:string;url:string}),url:'http://localhost:3000/api/verification',env:{NEXT_TELEMETRY_DISABLED:'1'}}});
