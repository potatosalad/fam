import {NewspapersClient} from './client.js';
import {NewspapersHttp} from './http.js';
import {loginNewspapers, type NewspapersSession} from './auth.js';
import {cookies, object, requireSession, type DoctorProvider} from '../shared/doctor-checks.js';
export const doctorProvider: DoctorProvider = {
 service:'newspapers',sessionFile:'newspapers/session.json',
 inspect(value){const s=object(value);requireSession(s.mode==='browser' && typeof s.browserInstance==='string' && /^[a-f0-9]{24}$/.test(s.browserInstance));cookies(s.cookies,true);return {mode:'browser',refreshAvailable:false};},
 recovery:()=> 'Run fam newspapers.session login and complete any browser verification.',
 login:{kind:'browser',run:()=>loginNewspapers()},
 probe:{id:'account',label:'Current account',async run(value){const s=value as NewspapersSession;const http=new NewspapersHttp(s.cookies,undefined,s.userAgent);await new NewspapersClient(http).me();return {session:{...s,cookies:http.jar.serializeSync(),savedAt:new Date().toISOString()}};}},
 limitations:['Verifies sign-in only. Subscription, page access, OCR, and downloads are separate permissions.'],
};
