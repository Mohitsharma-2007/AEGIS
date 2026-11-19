import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createVisionMiddleware, validateInput } from '../server/vision.js';
import { makePlanRequest, requestPlan, validateRuntime } from '../server/runtimes.js';
import { QWEN_4B } from '../src/engine/providers.js';
import { FILTER_PLAN, compilePlan } from '../src/engine/compile.js';
const jpg='data:image/jpeg;base64,/9j/AAAA';
const credential='test_provider_key';
const stub={headers:{host:'127.0.0.1:3000'},socket:{remoteAddress:'127.0.0.1'}};
const runtime=(id,model,input='vision',options={})=>validateRuntime({provider:id,model,input},{req:stub,env:{},key:credential,...options});
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});

test('text and vision input are bounded; text mode cannot forward pixels',()=>{
  assert.deepEqual(validateInput({prompt:'  Main concept  '},{input:'vision'}),{prompt:'Main concept',frame:'',ocr:'',context:''});
  assert.throws(()=>validateInput({},{input:'text'}),/source or enter/);
  assert.throws(()=>validateInput({frame:'https://example.com/img.jpeg'},{input:'vision'}),/resized JPEG/);
  assert.throws(()=>validateInput({frame:jpg},{input:'text'}),/does not accept screen pixels/);
});

test('native Ollama config is compact, schema-constrained and supports a 4-bit Qwen vision model',()=>{
  const r=runtime('ollama',QWEN_4B,'vision',{key:''});const request=makePlanRequest(r,{prompt:'Explain this',frame:jpg});
  assert.equal(request.url,'http://127.0.0.1:11434/api/chat');assert.equal(request.headers.Authorization,undefined);
  assert.equal(request.body.think,false);assert.equal(request.body.options.num_ctx,4096);assert.ok(request.body.options.num_predict<=550);
  assert.deepEqual(request.body.messages[1].images,['/9j/AAAA']);assert.ok(request.body.format.properties.parts);
  const text=makePlanRequest(runtime('ollama','qwen3:4b','text'),{prompt:'Explain',ocr:'ON-SCREEN TEST',frame:jpg});
  assert.match(text.body.messages[1].content,/ON-SCREEN TEST/);assert.equal(text.body.messages[1].images,undefined);
});

test('LM Studio, llama.cpp and compatible cloud APIs use the matching endpoints/auth',()=>{
  for(const [id,base] of [['lmstudio','http://127.0.0.1:1234/v1'],['llamacpp','http://127.0.0.1:8080/v1'],['openrouter','https://openrouter.ai/api/v1'],['groq','https://api.groq.com/openai/v1']]){
    const r=runtime(id,'vendor/model-vision');const target=makePlanRequest(r,{prompt:'Explain',frame:jpg});
    assert.equal(target.url,base+'/chat/completions');assert.equal(target.headers.Authorization,`Bearer ${credential}`);
    assert.equal(target.body.messages[1].content[1].image_url.url,jpg);
  }
  const a=makePlanRequest(runtime('anthropic','claude-choice'),{prompt:'Explain',frame:jpg});
  assert.equal(a.url,'https://api.anthropic.com/v1/messages');assert.equal(a.body.messages[0].content[0].source.data,'/9j/AAAA');assert.equal(a.headers['x-api-key'],credential);
  const g=makePlanRequest(runtime('gemini','models/gemini-2.5-flash'),{prompt:'Explain',frame:jpg});
  assert.equal(g.url,'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');assert.equal(g.body.contents[0].parts[1].inlineData.data,'/9j/AAAA');assert.equal(g.headers['x-goog-api-key'],credential);
});

test('server refuses hosted-to-loopback and arbitrary client endpoints, but operator configuration works',()=>{
  assert.throws(()=>runtime('ollama',QWEN_4B,'vision',{req:{...stub,headers:{host:'hosted.example'}}}),/same computer/);
  assert.throws(()=>runtime('ollama',QWEN_4B,'vision',{req:{...stub,headers:{host:'localhost',forwarded:'for=10.1.1.5'}}}),/same computer/);
  assert.throws(()=>runtime('cloud','my-model'),/set SIGHTLINE_CLOUD_BASE_URL/i);
  assert.throws(()=>runtime('cloud','my-model','vision',{env:{SIGHTLINE_CLOUD_BASE_URL:'http://api.example.com/v1'}}),/require HTTPS/);
  const own=runtime('cloud','my-model','vision',{env:{SIGHTLINE_CLOUD_BASE_URL:'https://api.example.com/v1'}});
  assert.equal(makePlanRequest(own,{prompt:'Draw'}).url,'https://api.example.com/v1/chat/completions');
});

test('supported schema compatibility fallback retries without forcing a response format',async()=>{
  const calls=[];const r=runtime('openrouter','some/model');
  const result=await requestPlan(r,{prompt:'Draw'},new AbortController().signal,async(url,init)=>{
    calls.push(JSON.parse(init.body));assert.equal(init.redirect,'error');
    return calls.length===1?json({error:{message:'response_format is not supported'}},400):json({choices:[{message:{content:JSON.stringify(FILTER_PLAN)}}]});
  });
  assert.equal(calls.length,2);assert.equal(calls[0].response_format.type,'json_object');assert.equal(calls[1].response_format,undefined);assert.match(result,/Water filtration/);
});

test('HTTP middleware routes cloud & local to the same plan and prevents cross-site requests',async t=>{
  const calls=[];const vision=createVisionMiddleware(async(url,init)=>{
    calls.push({url,init});const out=JSON.stringify(FILTER_PLAN);
    if(url.endsWith('/api/tags'))return json({models:[{name:QWEN_4B}]});
    return url.endsWith('/api/chat')?json({message:{content:out}}):json({choices:[{message:{content:out}}]});
  },{});
  const server=createServer((req,res)=>vision(req,res,()=>{res.writeHead(404);res.end();}));
  server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>server.close());
  const url=`http://127.0.0.1:${server.address().port}`;
  const hdr={'Content-Type':'application/json'},auth={...hdr,Authorization:`Bearer ${credential}`};
  const cloud={runtime:{provider:'openai',model:'gpt-4.1-mini',input:'vision'},prompt:'Explain the flow',frame:jpg};
  const local={...cloud,runtime:{provider:'ollama',model:QWEN_4B,input:'vision'}};
  const post=(path,body,headers)=>fetch(url+path,{method:'POST',headers,body:JSON.stringify(body)});
  assert.equal((await post('/api/scene',cloud,hdr)).status,401);
  assert.equal((await post('/api/scene',cloud,{...auth,'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal(calls.length,0);
  const catalog=await (await post('/api/models',local,hdr)).json();assert.equal(catalog.found,true);
  const left=await (await post('/api/scene',local,hdr)).json();
  const right=await (await post('/api/scene',cloud,auth)).json();
  assert.equal(left.provider,'Ollama');assert.equal(right.provider,'OpenAI');assert.deepEqual(left.plan,right.plan);
  assert.deepEqual(compilePlan(left.plan,'3d'),compilePlan(right.plan,'3d'));
});
