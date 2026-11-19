import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Check, Cloud, Code2, Copy, Cpu, Eye, Link2, LoaderCircle, ScanText, Server, Shield } from 'lucide-react';
import { defaultRuntime, isLocalRuntime, PROVIDERS, QWEN_4B } from '../engine/providers.js';
import { Modal } from './panels.jsx';

const QWEN_PULL=`ollama pull ${QWEN_4B}`;
const CLOUD_DEFAULT={provider:'openai',model:PROVIDERS.openai.model,input:'vision',format:'auto',key:'',preferModel:false};

export default function ModelDialog({runtime,onConnect,onDisconnect,onClose}) {
  const [form,setForm]=useState(()=>runtime?{...runtime}:{...defaultRuntime});
  const [cap,setCap]=useState(null),[models,setModels]=useState([]),[checking,setChecking]=useState(false),[feedback,setFeedback]=useState(null),[copied,setCopied]=useState(false);
  const abort=useRef(null),presetTouched=useRef(false);
  const local=isLocalRuntime(form.provider), provider=PROVIDERS[form.provider];
  const blocked=(local&&cap?.local===false)||(form.provider==='cloud'&&cap?.customCloud===false);
  useEffect(()=>{
    const c=new AbortController();
    fetch('/api/runtime',{signal:c.signal}).then(r=>r.ok?r.json():Promise.reject()).then(data=>{setCap(data);if(!runtime&&!presetTouched.current&&!data.local)setForm({...CLOUD_DEFAULT});}).catch(()=>{});
    return()=>{c.abort();abort.current?.abort();};
  },[]);
  function update(patch){presetTouched.current=true;abort.current?.abort();abort.current=null;setChecking(false);setFeedback(null);setCopied(false);setForm(x=>({...x,...patch}));}
  function select(id) {setModels([]);update({provider:id,model:PROVIDERS[id].model,input:'vision',format:'auto',key:''});}
  function chooseQwen(text=false){setModels([]);update({provider:'ollama',model:text?'qwen3:4b':QWEN_4B,input:text?'text':'vision',format:'auto',key:''});}
  function tokenOkay(k){return /^([!-~]{5,600})$/.test(k);}
  async function check() {
    const key=form.key.trim();
    if(!local&&!tokenOkay(key)){setFeedback({error:true,text:'Enter the provider API key before checking.'});return;}
    if(key&&!tokenOkay(key)){setFeedback({error:true,text:'Check the API key format.'});return;}
    setFeedback(null);setChecking(true);
    const ctrl=new AbortController();abort.current=ctrl;
    try{
      const {provider,model,input,format}=form;const config={provider,model,input,format};
      const res=await fetch('/api/models',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},signal:ctrl.signal,body:JSON.stringify({runtime:config})});
      const out=await res.json();if(!res.ok)throw new Error(out.error||'The runtime could not be checked.');
      if(ctrl.signal.aborted)return;
      setModels(out.models||[]);
      if(!form.model.trim()&&out.models?.length)setForm(x=>({...x,model:out.models[0]}));
      const text=out.found===false?`Reached ${out.provider}. The requested model wasn’t in its list; check the ID or load it first.`:out.models?.length?`Reached ${out.provider}. Select a listed model or enter its ID.`:`Reached ${out.provider}. No models were listed.`;
      setFeedback({error:false,text});
    }catch(e){if(!ctrl.signal.aborted)setFeedback({error:true,text:e.message||'The runtime could not be checked.'});}
    finally{if(abort.current===ctrl){abort.current=null;setChecking(false);}}
  }
  function submit(e){
    e.preventDefault();if(blocked)return;
    const model=form.model.trim(), key=form.key.trim();
    if(!model){setFeedback({error:true,text:'Enter the exact model ID, or use Check connection to list models.'});return;}
    if((!local||key)&&!tokenOkay(key)){setFeedback({error:true,text:'Enter a valid API key for this provider.'});return;}
    onConnect({...form,model,key});
  }
  const command=form.input==='text'?'ollama pull qwen3:4b':QWEN_PULL;
  return <Modal title="Model settings" eyebrow="MODEL-INDEPENDENT ENGINE" icon={Cpu} onClose={onClose} wide>
    <p>Use a lightweight local model or a cloud API. Models describe the subject; Sightline draws and animates the scene.</p>
    <div className="model-presets">
      <button type="button" className={form.provider==='ollama'?'chosen':''} onClick={()=>chooseQwen()}><Server size={18}/><span><b>Local Qwen 4B</b><small>Quantized · run on your machine</small></span></button>
      <button type="button" className={!local?'chosen':''} onClick={()=>select('openai')}><Cloud size={18}/><span><b>Cloud API</b><small>Bring your own provider key</small></span></button>
    </div>
    <form onSubmit={submit}>
      <div className="runtime-form-grid">
        <div><label htmlFor="model-provider">Model provider</label>
          <select id="model-provider" value={form.provider} onChange={e=>select(e.target.value)}>
            <optgroup label="On this computer">{Object.entries(PROVIDERS).filter(([,p])=>p.group==='local').map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</optgroup>
            <optgroup label="Online API">{Object.entries(PROVIDERS).filter(([,p])=>p.group==='cloud').map(([id,p])=><option key={id} value={id}>{p.name}</option>)}</optgroup>
          </select>
        </div>
        <div><label htmlFor="model-id">Model ID</label><input id="model-id" value={form.model} onChange={e=>update({model:e.target.value})} list="runtime-models" maxLength={175} spellCheck={false} autoComplete="off" placeholder="Exact ID from your runtime"/><datalist id="runtime-models">{models.map(s=><option key={s} value={s}/>)}</datalist></div>
      </div>
      <div className="runtime-hint">{provider.hint}{runtime?.provider===form.provider&&runtime?.model===form.model&&<span><Check size={12}/> Selected runtime</span>}</div>
      {form.provider==='ollama'&&<div className="model-command">
        <code>{command}</code><button type="button" aria-label="Copy Ollama command" title="Copy Ollama command" onClick={async()=>{try{await navigator.clipboard.writeText(command);setCopied(true);}catch{setFeedback({error:false,text:'You can select and copy the command shown above.'});}}}>{copied?<Check size={14}/>:<Copy size={14}/>}</button>
      </div>}
      {blocked&&<div className="runtime-warning" role="note"><Shield size={16}/><div>{local?<><strong>Run Sightline locally to connect.</strong><p>The hosted preview can’t reach the model server on your computer. Download the source, start Sightline there, and open its localhost address.</p></>:<><strong>Configure the custom endpoint on the server.</strong><p>Set <code>SIGHTLINE_CLOUD_BASE_URL</code> to your provider’s HTTPS OpenAI-compatible base and restart Sightline.</p></>}</div></div>}
      <div className="input-mode-label">Screen input</div>
      <div className="model-input toggles" role="group" aria-label="Model screen input">
        <button type="button" aria-pressed={form.input==='vision'} onClick={()=>update({input:'vision'})}><Eye size={15}/> Images (vision)</button>
        <button type="button" aria-pressed={form.input==='text'} onClick={()=>update({input:'text'})}><ScanText size={15}/> Text + OCR</button>
      </div>
      <div className="runtime-hint screen-input-hint">{form.input==='vision'?'For models that accept screenshots, including Qwen3-VL.':'Reads English screen text on-device. The model receives text, not pixels.'}{form.provider==='ollama'&&form.input==='text'&&form.model!== 'qwen3:4b'&&<button type="button" onClick={()=>chooseQwen(true)}>Use Qwen3:4b</button>}</div>
      {!local&&<div className="model-key"><label htmlFor="runtime-key">{provider.name} API key</label><input id="runtime-key" type="password" value={form.key} onChange={e=>update({key:e.target.value})} autoComplete="off" spellCheck={false} placeholder="Enter your provider key"/></div>}
      <details className="runtime-advanced">
        <summary><Code2 size={14}/> Compatibility options</summary>
        <div className="advanced-content">
          <label htmlFor="runtime-format">Response format</label>
          <select id="runtime-format" value={form.format} onChange={e=>update({format:e.target.value})}><option value="auto">Auto (structured when supported)</option><option value="json">JSON object</option><option value="plain">Prompt only</option></select>
          <label className="prefer-model"><input type="checkbox" checked={Boolean(form.preferModel)} onChange={e=>update({preferModel:e.target.checked})}/><span>Always ask the selected model <small>Skip instant recipes for recognized prompts.</small></span></label>
          {local&&<div className="model-key"><label htmlFor="runtime-local-token">Optional local API token</label><input id="runtime-local-token" type="password" value={form.key} onChange={e=>update({key:e.target.value})} autoComplete="off" spellCheck={false} placeholder="Only if your local server requires it"/></div>}
        </div>
      </details>
      <p className="form-note"><Shield size={15}/><span>{local?'Requests go to your configured local runtime; Sightline does not fall back to cloud. Use an installed, non-cloud model to keep inference local.':'The key is kept in tab memory and forwarded to this provider. Screen content is only sent on Visualize or while Follow changes is enabled. API usage may be billed.'}</span></p>
      {feedback&&<p className={'connection-feedback'+(feedback.error?' connected-error':'')} role={feedback.error?'alert':'status'}>{feedback.text}</p>}
      <div className="modal-buttons model-buttons">
        {runtime&&<button type="button" className="quiet-btn disconnect-model" onClick={onDisconnect}>Disconnect</button>}
        <button type="button" className="quiet-btn" disabled={blocked||checking} onClick={check}>{checking?<LoaderCircle size={15} className="spinning"/>:<Link2 size={15}/>}Check connection</button>
        <button type="submit" className="primary-btn" disabled={blocked||checking}>Use this model <ArrowUpRight size={15}/></button>
      </div>
    </form>
  </Modal>;
}
