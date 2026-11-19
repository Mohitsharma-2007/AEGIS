import { parsePlan } from '../src/engine/plan.js';
import { listModels, makeListRequest, requestPlan, RuntimeError, runtimeCapabilities, validateRuntime } from './runtimes.js';

const LIMIT=1_350_000;
const IMG=/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
const routes=new Set(['/api/scene','/api/runtime','/api/models']);
function send(res,status,data){
  if(res.destroyed||res.writableEnded)return;
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));
}
export function validateInput(body,r) {
  if(!body||typeof body!=='object'||Array.isArray(body))throw new RuntimeError(400,'Invalid request.');
  if(body.frame!=null && (typeof body.frame!=='string'||body.frame.length>LIMIT-7000||!IMG.test(body.frame)))throw new RuntimeError(400,'Use a resized JPEG capture frame.');
  if(r.input==='text'&&body.frame)throw new RuntimeError(400,'Text + OCR mode does not accept screen pixels.');
  const prompt=typeof body.prompt==='string'?body.prompt.trim().slice(0,1000):'';
  const ocr=typeof body.ocr==='string'?body.ocr.trim().slice(0,2400):'';
  const context=typeof body.context==='string'?body.context.trim().slice(0,170):'';
  if(!prompt&&!body.frame&&!ocr)throw new RuntimeError(400,'Share a readable source or enter a prompt.');
  return {prompt,frame:body.frame||'',ocr,context};
}
function headerKey(req){
  const value=req.headers.authorization;
  if(!value)return '';
  const key=/^Bearer ([!-~]{5,600})$/.exec(value)?.[1];
  if(!key)throw new RuntimeError(400,'That API key is not in a supported format.');
  return key;
}
async function requestJSON(req){
  if(!/^application\/json\b/i.test(req.headers['content-type']||''))throw new RuntimeError(415,'Expected a JSON request.');
  if(Number(req.headers['content-length']||0)>LIMIT)throw new RuntimeError(413,'The capture is too large.');
  let size=0;const chunks=[];
  for await(const chunk of req.iterator({destroyOnReturn:false})){
    size+=chunk.length;if(size>LIMIT){req.resume();throw new RuntimeError(413,'The capture is too large.');}chunks.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new RuntimeError(400,'Malformed JSON request.');}
}
export function createVisionMiddleware(fetcher=globalThis.fetch,env=process.env) {
  return async function vision(req,res,next){
    const path=req.url?.split('?')[0];
    if(!routes.has(path))return next();
    if(['cross-site','same-site'].includes(req.headers['sec-fetch-site']))return send(res,403,{error:'Send requests from the Sightline workspace.'});
    const want=path==='/api/runtime'?'GET':'POST';
    if(req.method!==want)return send(res,405,{error:`Use ${want} for this action.`});
    if(path==='/api/runtime')return send(res,200,runtimeCapabilities(req,env));
    let input,r;const models=path==='/api/models';
    try{
      const body=await requestJSON(req);
      r=validateRuntime(body?.runtime,{req,env,key:headerKey(req),optionalModel:models});
      if(!models)input=validateInput(body,r);
    }catch(e){return send(res,e.status||400,{error:e.status?e.message:'Invalid request.'});}
    const stop=new AbortController();
    const onClose=()=>{if(!res.writableEnded)stop.abort();};res.on('close',onClose);
    const timeout=AbortSignal.timeout(models?7500:r.local?90000:32000), signal=AbortSignal.any([stop.signal,timeout]);
    try{
      if(models){
        const {url,headers}=makeListRequest(r);
        const result=await fetcher(url,{method:'GET',headers,signal,redirect:'error'});
        if(!result.ok)throw new RuntimeError(result.status===401||result.status===403?401:502,`${r.profile.name} refused the model-list request. Check the server and any API key.`);
        const data=await result.json(), available=listModels(r,data);
        return send(res,200,{models:available.slice(0,100),found:r.model&&available.length?available.includes(r.model.replace(/^models\//,'')):null,provider:r.profile.name});
      }
      const output=await requestPlan(r,input,signal,fetcher);
      let plan;
      try{plan=parsePlan(output);}catch(e){throw new RuntimeError(422,e.message);}
      return send(res,200,{plan,model:r.model,provider:r.profile.name});
    }catch(e){
      if(timeout.aborted)return send(res,504,{error:`${r.profile.name} timed out. ${r.local?'The first run can be slower while the model loads. ':''}Your previous scene hasn’t changed.`});
      if(!stop.signal.aborted)return send(res,e.status||502,{error:e.status?e.message:r.local?`Could not reach ${r.profile.name}. Start its model server on the same machine as Sightline.`:`Could not reach ${r.profile.name}. Check the connection and try again.`});
    }finally{res.off('close',onClose);}
  };
}
export const visionMiddleware=createVisionMiddleware();
