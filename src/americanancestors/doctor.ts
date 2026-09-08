import {AmericanAncestorsHttp} from './http.js';
import {validSession,readAccount,type AmericanAncestorsSession} from './auth.js';
export const doctorProvider = {
  service:'americanancestors' as const,sessionFile:'americanancestors/session.json',
  inspect(value:unknown) {if (!validSession(value as AmericanAncestorsSession)) throw new Error('Invalid American Ancestors session.');new AmericanAncestorsHttp((value as AmericanAncestorsSession).cookies);return {mode:'native' as const,refreshAvailable:false};},
  recovery:()=>'Run fam americanancestors.session login. Login is explicit and never retried automatically.',
  probe:{id:'account',label:'Signed-in website session',async run(value:unknown) {const session=value as AmericanAncestorsSession;const http=new AmericanAncestorsHttp(session.cookies);await readAccount(http);return {session:{...session,cookies:http.jar.serializeSync(),validatedAt:new Date().toISOString()}};}},
  limitations:['Checks the signed-in website session only. Collection membership rights and individual records/images require separate reads. No password submission or account writes.'],
};
