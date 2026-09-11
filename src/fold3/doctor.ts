import {Fold3Client} from './client.js';
import {Fold3Http} from './http.js';
import {loginBrowser,type Fold3Session} from './auth.js';
import {cookies,object,requireSession,type DoctorProvider} from '../shared/doctor-checks.js';
export const doctorProvider:DoctorProvider={
  service:'fold3',sessionFile:'fold3/session.json',
  inspect(value){const s=object(value);requireSession(s.mode==='native'||s.mode==='browser'&&typeof s.browserInstance==='string'&&/^[a-f0-9]{24}$/.test(s.browserInstance));cookies(s.cookies,true);return {mode:s.mode as 'native'|'browser',refreshAvailable:false};},
  recovery:()=> 'Run fam fold3.session login and complete browser verification.',login:{kind:'browser',run:()=>loginBrowser()},
  probe:{id:'account',label:'Current Fold3 account',async run(value){const s=value as Fold3Session,http=new Fold3Http(s.cookies,undefined,s.userAgent);await new Fold3Client(http).me();return {session:{...s,cookies:http.jar.serializeSync(),savedAt:new Date().toISOString()}};}},
  limitations:['Sign-in, Fold3 subscription access, OCR availability, and scan download permission are separate checks.'],
};
