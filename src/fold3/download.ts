import sharp from 'sharp';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,link,rm} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {stringifyJson} from '../shared/json.js';
import {Fold3Client} from './client.js';
import {Fold3Error,IMG} from './http.js';
import {id,imageDetails} from './parse.js';
export async function downloadImage(client:Fold3Client,value:string){
  const identity=id(value),authorization=await client.imageAuthorization(identity),details=imageDetails(authorization,identity);
  if(!details.permissions.allowed.includes('VIEW')||!details.permissions.allowed.includes('DOWNLOAD'))throw new Fold3Error('access-denied');
  const publication=details.publicationId?await client.publication(details.publicationId):undefined;
  const token=authorization.r?.o?.token;
  if(typeof token!=='string'||!token)throw new Fold3Error('api-changed');
  const url=new URL('/img/img',IMG);url.search=new URLSearchParams({id:identity,token,a:'download',width:'0',height:'0',rotation:'0',anchor:identity,title:details.title??`Fold3 ${identity}`}).toString();
  const response=await client.http.request(url);
  if(!/^(image\/jpeg|application\/octet-stream)(?:;|$)/i.test(response.contentType))throw new Fold3Error('api-changed');
  let dimensions;
  try{const scan=sharp(response.bytes,{failOn:'warning',limitInputPixels:100_000_000});dimensions=await scan.metadata();if(dimensions.format!=='jpeg'||!dimensions.width||!dimensions.height)throw new Error();await scan.stats();}catch{throw new Fold3Error('api-changed');}
  return {bytes:response.bytes,metadata:{...details,sourceWidth:details.width,sourceHeight:details.height,width:dimensions.width,height:dimensions.height,format:'jpeg',bytes:response.bytes.length,
    sha256:createHash('sha256').update(response.bytes).digest('hex'),downloadedAt:new Date().toISOString(),representation:'Fold3 whole-image Save as JPG export.',
    citation:{provider:'Fold3',sourceUrl:details.sourceUrl,title:details.title,publicationId:details.publicationId,publication,metadata:details.metadata}}};
}
export async function saveDownload(path:string,result:Awaited<ReturnType<typeof downloadImage>>){
  path=resolve(path);await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=`${path}.${randomUUID()}.tmp`,sidecar=`${path}.json`,sideTemp=`${sidecar}.${randomUUID()}.tmp`;
  try{await writeFile(temp,result.bytes,{mode:0o600,flag:'wx'});await writeFile(sideTemp,stringifyJson(result.metadata,2)+'\n',{mode:0o600,flag:'wx'});await link(temp,path);try{await link(sideTemp,sidecar);}catch(error){await rm(path);throw error;}}
  finally{await rm(temp,{force:true});await rm(sideTemp,{force:true});}
  return {saved:path,sidecar,...result.metadata};
}
