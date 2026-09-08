import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AmericanAncestorsHttp,checkUrl,WEB,APP,ACCOUNT,type Transport} from '../src/americanancestors/http.js';
import {authenticate,readAccount,sessionStatus} from '../src/americanancestors/auth.js';
import {AmericanAncestorsClient,searchQuery} from '../src/americanancestors/client.js';
import {searchResults,recordDetails,imageDetails} from '../src/americanancestors/parse.js';
import {deepZoom} from '../src/americanancestors/download.js';
import {parseInvocation} from '../src/shared/command-runtime.js';
import {commands} from '../src/shared/command-registry.js';
import {resolveContext} from '../src/shared/command-search.js';
const response = (text:string,status=200,headers:Record<string,string>={}) => new Response(text,{status,headers:{'content-type':'text/html',...headers}});
const loginForm = '<form id="tn-login-form"><input name="__RequestVerificationToken" value="fixture-csrf"></form>';

test('single native login, scoped cookies, validated account, redacted status',async()=>{
  let posts=0;const seen:string[]=[];
  const http=new AmericanAncestorsHttp(undefined,async(url,init)=>{
    seen.push(url);const u=new URL(url);
    if(init.method==='POST') {posts++;assert.equal(u.origin,ACCOUNT);assert.equal(new URLSearchParams(init.body).get('PatronAccountLogin.Password'),'fixture-secret');return response('',302,{location:`${APP}/account/refreshcredentials`,'set-cookie':'identity=fixture; Secure; HttpOnly; Path=/'});}
    if(u.origin===ACCOUNT)return response(loginForm);
    if(u.origin===APP) {assert.ok(!init.headers.Cookie?.includes('identity='));return response('',302,{location:`${WEB}/search/advanced-search`});}
    return response('<a class="nav-link--user-logout">Logout</a>');
  });
  let saved:any;
  const session=await authenticate(http,{username:'fixture@example.test',password:'fixture-secret'},async s=>{saved=s;});
  assert.equal(posts,1);assert.equal(saved,session);assert.equal(seen.length,5);assert.equal(sessionStatus(session).sessionSaved,true);
  assert.ok(!JSON.stringify(sessionStatus(session)).includes('fixture'));assert.ok(!JSON.stringify(session).includes('fixture-secret'));
});
test('password POST is never replayed on redirects or failed login',async()=>{
  for(const status of [307,308,401,403,429,500]) {
    let posts=0,saved=false;
    const http=new AmericanAncestorsHttp(undefined,async(_url,init)=>init.method==='GET'?response(loginForm):(posts++,response('private-response',status,{location:`${ACCOUNT}/account/login`})));
    await assert.rejects(authenticate(http,{username:'fixture',password:'fixture-secret'},async()=>{saved=true;}), e=>!String(e).includes('fixture-secret')&&!String(e).includes('private-response'));
    assert.equal(posts,1);assert.equal(saved,false);
  }
});
test('account checks never accept guest HTML or submit credentials',async()=>{
  let requests=0;const http=new AmericanAncestorsHttp(undefined,async(_url,init)=>{requests++;assert.equal(init.method,'GET');return response('<a>Log in</a>');});
  await assert.rejects(readAccount(http),/session is missing or rejected/);assert.equal(requests,1);
});
test('origins, media cookies, and network error redaction',async()=>{
  for(const u of ['http://app.americanancestors.org/','https://app.americanancestors.org.evil.test/','https://name:secret@app.americanancestors.org/','https://app.americanancestors.org/#token'])assert.throws(()=>checkUrl(u));
  assert.throws(()=>checkUrl('https://evil.img.americanancestors.org/a.xml',true));
  const http=new AmericanAncestorsHttp(undefined,async(_u,init)=>{assert.equal(init.headers.Cookie,undefined);return response('xml');});
  await http.jar.setCookie('identity=fixture; Domain=americanancestors.org; Path=/; Secure',APP);
  await http.request('https://75.img.americanancestors.org/a.xml',{media:true});
  let calls=0;const redirect=new AmericanAncestorsHttp(undefined,async()=>{calls++;return response('',302,{location:'https://evil.test/token'});});
  await assert.rejects(redirect.text(APP),/outside/);assert.equal(calls,1);
  await assert.rejects(http.request(APP,{body:new URLSearchParams({password:'fixture'})}),/Only the explicit/);
  const broken=new AmericanAncestorsHttp(undefined,async()=>{throw Error('secret URL');});await assert.rejects(broken.text(APP), e=>!String(e).includes('secret URL'));
});
test('search criteria preserve titles, Unicode and wildcards, validate filters',()=>{
  const q=searchQuery({lastName:'D’Angelo*',collection:'A & B',fromYear:'1730',toYear:'1740',page:2,exact:true});
  assert.equal(q.get('lastname'),'D’Angelo*');assert.equal(q.get('database'),'A & B');assert.equal(q.get('page'),'2');assert.equal(q.get('exactYear'),'true');
  for(const options of [{},{lastName:'A',page:0},{lastName:'A',exact:true,soundex:true},{lastName:'A',fromYear:'1740',toYear:'1730'},{lastName:'A',fromYear:'173x'},{lastName:'A',volumeId:'1'}])assert.throws(()=>searchQuery(options));
});
function results(total:number,page=1) {return `<input class="total-hits" value="${total}"><input class="index-page" value="${page}"><input class="page-size" value="50"><div id="tblSearchResult"><table><tbody>${total?'<tr><td><a id="name-9007199254740993" href="/DB27/r/9007199254740993">Example Person</a><div class="nameValueDiv">Example Collection</div><a id="image-9007199254740993" href="/databases/example/image/?volumeId=1&amp;pageName=2&amp;rId=9007199254740993">View Image</a></td><td><label class="labelDivStyle">BIRTH</label><div class="valueDiv">1735</div><p class="placeholder-text"></p></td><td>Example Parent</td></tr>':''}</tbody></table></div>`;}
test('search parsing preserves exact IDs, masks, citations links and continuation',()=>{
  const data=searchResults(results(51),searchQuery({lastName:'Example'}));assert.equal(data.items[0].recordId,'9007199254740993');assert.equal(data.items[0].masked,true);assert.equal(data.items[0].fields[0].value,'1735');assert.equal(data.nextPage,2);assert.match(data.nextUrl!,/lastname=Example/);
  assert.equal(searchResults(results(0),searchQuery({lastName:'NoMatch'})).nextPage,null);
  assert.throws(()=>searchResults('<html>Unavailable</html>',searchQuery({lastName:'A'})),/format changed/);
});
test('record parsing distinguishes access gates and returns citation and indexed values',()=>{
  const r=recordDetails('<input id="hdnRecordid" value="9007199254740993"><table id="tblRecordDislpay"><tr><td>Name</td><td>Example</td></tr><tr><td>Original Text</td><td>Child of Example</td></tr></table><div id="divClipboardURLTranscript">Example citation /DB27/r/9007199254740993</div>',WEB);
  assert.equal(r.fields[1].value,'Child of Example');assert.match(r.citation,/Example citation/);
  assert.throws(()=>recordDetails('<div id="tblTranscript">Please log in to continue. Become a member.</div>',WEB),/did not grant access/);
});
test('image parser never exposes partner tokens and rejects hostile image URLs',()=>{
  const html=(url:string,partner:boolean)=>`<script>initImage('${url}', jQuery.parseJSON('${partner}'), 'id', 'key', 'bucket', 'file', 'Example', 'fixture-private-token')</script><a id="download"></a>`;
  const partner=imageDetails(html('https://familysearch.org/ark:/61903/3:1:EXAMPLE',true),WEB);
  assert.equal(partner.kind,'familysearch');assert.equal(partner.downloadAvailable,false);assert.ok(!JSON.stringify(partner).includes('fixture-private-token'));
  assert.equal(imageDetails(html('https://75.img.americanancestors.org/abcd.xml',false),WEB).kind,'deepzoom');
  assert.throws(()=>imageDetails(html('https://evil.test/abcd.xml',false),WEB));
});
test('Deep Zoom validates resource bounds and tile overlap',()=>{
  const xml=(w:number)=>`<Image TileSize="256" Overlap="1" Format="jpg"><Size Width="${w}" Height="900"/></Image>`;
  assert.deepEqual(deepZoom(xml(548)),{width:548,height:900,tileSize:256,overlap:1,format:'jpg',columns:3,rows:4,level:10});
  assert.throws(()=>deepZoom(xml(1e9)));assert.throws(()=>deepZoom('<html>Access denied</html>'));
});
test('provider registry exposes implemented commands and source URL context',()=>{
  const list=commands.filter(c=>c.provider==='americanancestors');assert.ok(list.length>10);assert.ok(!list.some(c=>c.object==='api.gql'||c.action==='refresh'||c.action==='call'));
  const invocation=parseInvocation(['americanancestors.record','search','--last-name','Example','--soundex','--from-year','1730','--json']);assert.ok(invocation.args.includes('--soundex'));
  assert.equal(resolveContext(`${WEB}/DB27/r/123`).provider,'americanancestors');
  assert.equal(resolveContext(`${WEB}/databases/example/image/?volumeId=1&pageName=2&rId=3`).object,'image');
});

test('scan download validates octet-stream pixels, removes tile overlap and refuses overwrite',async()=>{
  const {default:sharp}=await import('sharp');const {downloadImage,saveDownload}=await import('../src/americanancestors/download.js');
  const {mkdtemp,readFile,stat,rm}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
  const requests:string[]=[];
  const transport:Transport=async(url,init)=>{
    requests.push(url);assert.equal(init.headers.Cookie,undefined);
    if(url.endsWith('.xml'))return response('<Image TileSize="64" Overlap="1" Format="png"><Size Width="100" Height="100"/></Image>');
    const match=url.match(/\/(\d+)_(\d+)\.png$/)!;assert.ok(match);const x=Number(match[1]),y=Number(match[2]);
    const bytes=await sharp({create:{width:x?37:65,height:y?37:65,channels:3,background:x?'blue':'red'}}).png().toBuffer();
    return new Response(bytes,{headers:{'content-type':'binary/octet-stream'}});
  };
  const client=new AmericanAncestorsClient(new AmericanAncestorsHttp(undefined,transport));
  client.image=async()=>imageDetails("<script>initImage('https://75.img.americanancestors.org/abcd.xml', jQuery.parseJSON('false'))</script><a id='download'></a><div id='divClipboardURLTranscript'>Example citation</div>",WEB);
  const result=await downloadImage(client,WEB);assert.equal(result.metadata.tiles,4);assert.equal(requests.length,5);
  const pixels=await sharp(result.bytes).removeAlpha().raw().toBuffer();assert.deepEqual([...pixels.subarray(0,3)],[255,0,0]);assert.deepEqual([...pixels.subarray(64*3,64*3+3)],[0,0,255]);
  const dir=await mkdtemp(join(tmpdir(),'fam-aa-image-')),path=join(dir,'scan.png');
  try {await saveDownload(path,result);assert.equal((await stat(path)).mode&0o777,0o600);assert.match(await readFile(path+'.json','utf8'),/Example citation/);await assert.rejects(saveDownload(path,result));assert.deepEqual(await readFile(path),result.bytes);}
  finally {await rm(dir,{recursive:true,force:true});}
});
