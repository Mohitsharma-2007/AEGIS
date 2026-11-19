import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, ArrowUpRight, Box, ChevronRight, CircleCheck, Download, Ellipsis, Fan, FileJson, Layers, LoaderCircle, Mic, MonitorUp, PanelTop, PictureInPicture2, ScanLine, Sparkles, Square, Wind, Workflow, X } from 'lucide-react';
import { EXAMPLES, demoAnswer, quickDrawing } from './engine/examples.js';
import { compilePlan, editorialExample, FILTER_PLAN } from './engine/compile.js';
import { knownPlan, parsePlan } from './engine/plan.js';
import { isLocalRuntime, PROVIDERS } from './engine/providers.js';
import { readScreenText } from './engine/ocr.js';
import { difference, fingerprint, traceFrame } from './engine/trace.js';
import { sceneFromText } from './engine/schema.js';
import { aeroScene, labKind } from './engine/aero/scenes.js';
import { useAeroLab } from './components/AeroLab.jsx';
import Stage from './components/Stage.jsx';
import { CaptureDialog, ImportDialog, Sidebar } from './components/panels.jsx';
import ModelDialog from './components/ModelDialog.jsx';

const sampleSource=(id)=>{const item=EXAMPLES.find(x=>x.id===id)||EXAMPLES[0];return {type:'demo',name:item.name,url:item.source};};
// Deep links from the AEGIS model library: /sightline/?demo=<id>&mode=3d|2d&variant=engine
const params=new URLSearchParams(window.location.search);
const requested=params.get('demo');
const initialSample=EXAMPLES.some(x=>x.id===requested)?requested:(requested==='airflow'?'lab':'pi');
const initialMode=params.get('mode')==='2d'?'2d':'3d';
const initialVariant=params.get('variant')==='engine'?'engine':undefined;
const initialScene=initialSample==='filter'
  ?compilePlan(FILTER_PLAN,initialMode)
  :editorialExample(initialSample,initialMode,initialVariant);
const initial={scene:initialScene,origin:'demo',elapsed:null,index:1};
const emptyState={scene:null,origin:null,elapsed:null};

export default function App() {
  const [example,setExample]=useState(initialSample),[source,setSource]=useState(()=>sampleSource(initialSample)),[mode,setMode]=useState(initialMode),[record,setRecord]=useState(initial);
  const [prompt,setPrompt]=useState(''),[runtime,setRuntime]=useState(null),[follow,setFollow]=useState(false);
  const lab=useAeroLab(labKind(record.scene));
  const [job,setJob]=useState('model'),[tour,setTour]=useState(null);
  const [busy,setBusy]=useState(false),[sharing,setSharing]=useState(false),[listening,setListening]=useState(false);
  const [dialog,setDialog]=useState(null),[menu,setMenu]=useState(false),[toast,setToast]=useState(null),[floating,setFloating]=useState(null);
  const screenVideo=useRef(null),sourceImage=useRef(null),imageInput=useRef(null),promptInput=useRef(null),sampleCanvas=useRef(null),menuRef=useRef(null);
  const streamRef=useRef(null),imageURL=useRef(null),sourceToken=useRef(null),recognition=useRef(null),request=useRef(null),starting=useRef(false);
  const lastFrame=useRef(null),lastQuery=useRef(''),scenes=useRef({'3d':initial}),sequence=useRef(2),followEngine=useRef(null),clearRef=useRef(null),floatRef=useRef(null);
  const state=useRef({});
  state.current={example,source,mode,record,prompt,runtime,follow};

  const notify=(text,kind='info')=>setToast({text,kind});
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(timer);},[toast]);
  useEffect(()=>{if(!menu)return;const handler=e=>{if(!menuRef.current?.contains(e.target))setMenu(false);};const key=e=>{if(e.key==='Escape')setMenu(false);};document.addEventListener('pointerdown',handler);document.addEventListener('keydown',key);return()=>{document.removeEventListener('pointerdown',handler);document.removeEventListener('keydown',key);};},[menu]);
  useEffect(()=>{
    const key=e=>{if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){e.preventDefault();promptInput.current?.focus();}};
    const paste=e=>{
      if(e.target?.closest?.('input, textarea, [contenteditable], [role="dialog"]'))return;
      const file=[...(e.clipboardData?.files || [])].find(f=>f.type.startsWith('image/'));
      if(file){e.preventDefault();loadImage(file);}
    };
    window.addEventListener('keydown',key);window.addEventListener('paste',paste);
    return()=>{window.removeEventListener('keydown',key);window.removeEventListener('paste',paste);streamRef.current?.getTracks().forEach(track=>track.stop());if(imageURL.current)URL.revokeObjectURL(imageURL.current);request.current?.abort();floatRef.current?.window.close();try{recognition.current?.abort();}catch{}};
  },[]);

  function abortRequest() { if(request.current)request.current.abort();request.current=null;setBusy(false); }
  function releaseSource() {
    const stream=streamRef.current;streamRef.current=null;
    stream?.getTracks().forEach(x=>x.stop());
    if (imageURL.current){URL.revokeObjectURL(imageURL.current);imageURL.current=null;}
    if(sampleCanvas.current){sampleCanvas.current.width=1;sampleCanvas.current.height=1;}
    sourceToken.current=null;
    setFollow(false); lastFrame.current=null;lastQuery.current='';scenes.current={};abortRequest();
  }
  function applyScene(scene,origin,elapsed=null,auto=false,meta={}) {
    const old=scenes.current[scene.mode];
    if(scene.title!==state.current.record.scene?.title)setTour(null);
    const idx=auto&&old?old.index:sequence.current++;
    const next={scene,origin,elapsed,index:idx,...meta};
    scenes.current[scene.mode]=next;setMode(scene.mode);setRecord(next);
  }
  function showExample(id, selectedMode, variant, elapsed=null) {
    const item=EXAMPLES.find(x=>x.id===id)||EXAMPLES[0];
    if (state.current.source.type!=='demo'||state.current.example!==id) releaseSource();
    setExample(id);setSource(sampleSource(id));
    const m=selectedMode||item.mode;
    if(id==='filter'){applyScene(compilePlan(FILTER_PLAN,m),'recipe',elapsed,false,{plan:FILTER_PLAN});return;}
    applyScene(editorialExample(id,m,variant),'demo',elapsed);
  }
  function clearSource() {showExample(state.current.example,state.current.mode);}
  clearRef.current=clearSource;

  function captureFrame() {
    const {source:src}=state.current, isVideo=src.type==='screen';
    const element=isVideo?screenVideo.current:sourceImage.current;
    if(!element)return null;
    const w=isVideo?element.videoWidth:element.naturalWidth,h=isVideo?element.videoHeight:element.naturalHeight;
    if(!w||!h||(isVideo&&element.readyState<2))return null;
    const cfg=state.current.runtime, bounds=cfg?.input==='text'?[1440,1000]:cfg?.scope==='local'?[864,672]:[1024,768];
    const ratio=Math.min(1,bounds[0]/w,bounds[1]/h);
    const canvas=sampleCanvas.current||document.createElement('canvas');sampleCanvas.current=canvas;
    const tw=Math.max(1,Math.round(w*ratio)), th=Math.max(1,Math.round(h*ratio));
    if(canvas.width!==tw)canvas.width=tw;if(canvas.height!==th)canvas.height=th;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='#fff';ctx.fillRect(0,0,tw,th);ctx.drawImage(element,0,0,tw,th);
    return canvas;
  }
  function outline(srcCanvas, selectedMode, auto=false, start=performance.now()) {
    const next=traceFrame(srcCanvas,selectedMode);
    applyScene(next,'trace',performance.now()-start,auto);
  }
  function onSourceReady() {
    const {source:src,mode:m}=state.current;
    if(src.type==='demo'||sourceToken.current===(src.stream||src.url))return;
    try{
      const frame=captureFrame();if(!frame)return;
      sourceToken.current=src.stream||src.url;
      outline(frame,m,true);
    }catch{notify('Could not read that source. Try a different image or browser window.','error');}
  }
  function openImagePicker() {setDialog(null);imageInput.current?.click();}
  function loadImage(file) {
    if(!file)return;
    if(!file.type.startsWith('image/')||file.size>15_000_000){notify('Choose an image smaller than 15 MB.','error');return;}
    releaseSource();const url=URL.createObjectURL(file);imageURL.current=url;
    setSource({type:'image',name:file.name||'Pasted image',url});setRecord({...emptyState,index:sequence.current});
    // The visible thumbnail drives frame analysis. This also gives a clear error for corrupt files.
    const check=new Image();check.onerror=()=>{if(imageURL.current===url){notify('This image couldn’t be opened. Try PNG, JPEG, or WebP.','error');clearRef.current();}};check.src=url;
  }
  async function shareScreen() {
    if(streamRef.current){clearSource();return;}
    if(starting.current)return;
    const policy=document.permissionsPolicy||document.featurePolicy;
    if(!navigator.mediaDevices?.getDisplayMedia || policy?.allowsFeature?.('display-capture')===false){setDialog({type:'capture',blocked:true});return;}
    starting.current=true;setSharing(true);
    try {
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:{ideal:12,max:15}},audio:false,preferCurrentTab:false,selfBrowserSurface:'exclude',surfaceSwitching:'include'});
      const track=stream.getVideoTracks()[0];
      if(!track){stream.getTracks().forEach(t=>t.stop());throw new Error('No screen selected.');}
      releaseSource();streamRef.current=stream;
      const name={monitor:'Shared screen',window:'Shared window',browser:'Shared tab'}[track.getSettings?.().displaySurface]||'Shared screen';
      setSource({type:'screen',name,stream});setRecord({...emptyState,index:sequence.current});
      track.addEventListener('ended',()=>{if(streamRef.current===stream){clearRef.current();notify('Screen sharing stopped.');}},{once:true});
      notify('Screen shared. Turn on Follow changes for automatic updates.','success');
    } catch(e) {
      if(window.self!==window.top&&(['NotAllowedError','SecurityError','InvalidStateError','NotSupportedError'].includes(e.name)))setDialog({type:'capture',blocked:true});
      else if(e.name==='NotAllowedError'||e.name==='AbortError') notify('Screen sharing was not started.');
      else notify('Could not capture the display. Try an up-to-date desktop browser or upload an image.','error');
    } finally {starting.current=false;setSharing(false);}
  }
  function switchMode(next) {
    const current=state.current;if(current.mode===next)return;
    setMode(next);
    if(labKind(current.record.scene)){
      applyScene(aeroScene(labKind(current.record.scene),next),current.record.origin);
    }else if(current.record.plan){
      applyScene(compilePlan(current.record.plan,next),current.record.origin,null,false,{plan:current.record.plan,modelLabel:current.record.modelLabel});
    }else if(current.source.type==='demo'&&current.record.origin==='demo'){
      const variant=current.record.scene?.view==='camera'?'camera':undefined;
      applyScene(editorialExample(current.example,next,variant),'demo');
    }else if(scenes.current[next]?.origin!=='trace'&&scenes.current[next])setRecord(scenes.current[next]);
    else if(current.source.type!=='demo'){
      let frame;try{frame=captureFrame();}catch{}
      if(frame)outline(frame,next,true);else setRecord({...emptyState,index:sequence.current});
    }else setRecord({...emptyState,index:sequence.current});
  }

  function directRecipe(q) {
    if(!q)return null;
    const steps=q.replace(/^\s*(?:draw|show|make|create)\s+(?:a\s+)?(?:flowchart(?:\s+(?:of|for))?\s*[:\-]?\s*)?/i,'').split(/\s*(?:→|->)\s*/).map(x=>x.trim()).filter(Boolean);
    if(steps.length>1)return {kind:'process',title:'Process flow',summary:'A visual sequence from your steps.',asset:'none',parts:steps.slice(0,5).map((name,i)=>({name:name.slice(0,32),note:'',form:['block','chip','panel','ring','flow'][i]}))};
    if(q.length<155&&!/compar(e|ison)|versus|\bvs\b|not about|instead of/i.test(q)){
      if(/^(?:(?:draw|show|explain|visualize)\s+(?:me\s+)?(?:a\s+)?(?:diagram\s+of\s+)?|)water filtration(?: in [23]d)?[.!]?$/i.test(q))return FILTER_PLAN;
      return knownPlan(q);
    }
    return null;
  }

  async function visualize({query,automatic=false,sceneMode,canvas}={}) {
    const current=state.current,m=sceneMode||current.mode,cfg=current.runtime;
    const q=(query??current.prompt).trim().slice(0,1000),start=performance.now();
    if(automatic&&request.current)return;
    if(!automatic){abortRequest();lastQuery.current=q;}
    const done=(plan,origin,modelLabel)=>{
      const out=state.current.mode!==current.mode?state.current.mode:m;
      applyScene(compilePlan(plan,out),origin,performance.now()-start,automatic,{plan,modelLabel});
    };
    if(!automatic&&current.record.scene?.story?.steps.length&&/^(?:play (?:the )?(?:walkthrough|tour)|guide me through this(?: scene)?)[.!]?$/i.test(q)){
      setTour({title:current.record.scene.title});return;
    }
    if(!automatic&&!cfg?.preferModel){
      const recipe=directRecipe(q);
      if(recipe){done(recipe,'recipe');return;}
      const simple=q?quickDrawing(q,m):null;
      if(simple){applyScene(simple,'local',performance.now()-start);return;}
      if(current.source.type==='demo'){
        if(current.example==='filter'&&(!q||/explain this|show the steps|filter demo/i.test(q))){done(FILTER_PLAN,'recipe');return;}
        if(current.example!=='filter'){
          const preset=q?demoAnswer(q,current.example,m):{id:current.example,scene:editorialExample(current.example,m,current.record.scene?.view==='camera'?'camera':labKind(current.record.scene)||undefined)};
          if(preset){
            const fallback=preset.scene.view==='camera'?'camera':labKind(preset.scene)||undefined;
            const sameLab=current.example==='lab'&&preset.id==='lab'&&!preset.variant&&/this|current example/i.test(q);
            showExample(preset.id,m,preset.variant||(sameLab?labKind(current.record.scene)||fallback:fallback),performance.now()-start);return;
          }
        }
      }
    }
    const needFrame=current.source.type!=='demo'||!q||/this screen|visible|this page|on (my|the) screen|this image|screenshot|current source/i.test(q);
    let frame=canvas;
    if(!frame&&needFrame){try{frame=captureFrame();}catch{}}
    if(!cfg){
      if(current.source.type!=='demo'&&frame){outline(frame,m,automatic,start);if(!automatic&&q)notify('Local trace draws geometry only. Choose a model for explanations.');}
      else if(current.source.type!=='demo')notify('The source is still loading. Try again in a moment.');
      else notify('Try a sample, “draw a blue cube”, or choose a model in Model settings.');
      return;
    }
    if(!frame&&current.source.type!=='demo'){if(!automatic)notify('The source is still loading. Try again in a moment.');return;}
    const controller=new AbortController();request.current=controller;setBusy(true);setJob(cfg.scope==='local'?'local-model':'model');
    try {
      let image=null,ocr='';
      if(frame&&cfg.input==='text'){
        setJob('ocr');
        const snapshot=frame.toDataURL('image/jpeg',.84);
        try {const read=await readScreenText(snapshot,controller.signal);ocr=read.text||'';
          if(!cfg.preferModel&&read.confidence>=52&&(!q||/explain|label|visualize|what|diagram/i.test(q))){const known=knownPlan(q,ocr);if(known&&request.current===controller){done(known,'recipe');return;}}
        }catch(e){if(e.name==='AbortError')throw e;if(!q)throw new Error('On-device text recognition failed. Try a clearer image or a vision model.');}
        if(!ocr&&!q)throw new Error('No readable text was found on the screen. Try a closer view or a vision model.');
      }else if(frame)image=frame.toDataURL('image/jpeg',.76);
      if(request.current!==controller||controller.signal.aborted)return;
      const {key,provider,model,input,format}=cfg;
      const context=/\b(it|that|this scene|previous|make it)\b/i.test(q)?current.record.scene?.title||'':'';
      setJob(cfg.scope==='local'?'local-model':'model');
      const res=await fetch('/api/scene',{method:'POST',headers:{'Content-Type':'application/json',...(key?{Authorization:`Bearer ${key}`}:{})},signal:controller.signal,body:JSON.stringify({runtime:{provider,model,input,format},prompt:q,frame:image,ocr,context})});
      const data=await res.json();if(!res.ok)throw new Error(data.error||'The model request failed.');
      if(request.current!==controller||controller.signal.aborted)return;
      done(data.plan,'AI',`${cfg.scope==='local'?'Local':'Cloud'} · ${cfg.name}`);
    }catch(e){
      if(e.name!=='AbortError'&&request.current===controller){notify((e.message||'Model request failed.')+(automatic?' Follow changes paused.':''),'error');if(automatic)setFollow(false);}
    }finally{if(request.current===controller){request.current=null;setBusy(false);}}
  }
  function toggleFollow() {
    const current=state.current;
    if(current.source.type!=='screen'){notify('Share a screen to follow its changes live.');return;}
    lastFrame.current=null;
    if(current.follow){abortRequest();setFollow(false);notify('Follow changes paused.');}
    else {setFollow(true);const cfg=current.runtime;notify(cfg?`Follow enabled. Changed ${cfg.input==='text'?'screen text':'snapshots'} will go to ${cfg.name}.`:'Following screen changes locally.','success');}
  }
  followEngine.current=()=>{
    if(!state.current.follow||state.current.source.type!=='screen'||request.current||(document.hidden&&!floatRef.current))return;
    try {
      const canvas=captureFrame();if(!canvas)return;
      const now=fingerprint(canvas);
      if(difference(lastFrame.current,now)<.049)return;
      lastFrame.current=now;
      visualize({query:lastQuery.current,automatic:true,canvas});
    }catch{setFollow(false);notify('Could not sample the screen. Follow changes paused.','error');}
  };
  useEffect(()=>{
    if(!follow||source.type!=='screen')return;
    const tick=()=>followEngine.current?.();tick();
    const clock=floating?.window||window;
    const timer=clock.setInterval(tick,runtime?(runtime.input==='text'?3300:runtime.scope==='local'?2400:3200):850);
    return()=>clock.clearInterval(timer);
  },[follow,source.type,source.stream,runtime,floating]);

  async function floatCanvas() {
    if(floatRef.current){floatRef.current.window.close();return;}
    if(!window.documentPictureInPicture){notify('Floating view is available in recent desktop Chromium browsers.');return;}
    if(window.self!==window.top){setDialog({type:'capture',blocked:true,reason:'float'});return;}
    try {
      const win=await window.documentPictureInPicture.requestWindow({width:704,height:456});
      win.document.title='Sightline · Floating canvas';
      const base=win.document.createElement('base');base.href=window.location.href;win.document.head.prepend(base);
      for(const style of document.head.querySelectorAll('style, link[rel="stylesheet"]'))win.document.head.append(style.cloneNode(true));
      const container=win.document.createElement('div');container.className='floating-root';win.document.body.classList.add('floating-body');win.document.body.append(container);
      const state={window:win,container};floatRef.current=state;setFloating(state);
      win.addEventListener('pagehide',()=>{if(floatRef.current===state){floatRef.current=null;setFloating(null);}},{once:true});
    } catch {notify('The floating window couldn’t open. Try a recent desktop Chromium browser.','error');}
  }

  function dictate() {
    if(recognition.current){recognition.current.stop();return;}
    const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!SpeechRecognition){notify('Voice input isn’t supported here. Type your prompt instead.');return;}
    try {
      const instance=new SpeechRecognition();instance.lang=navigator.language||'en-US';instance.interimResults=false;instance.continuous=false;
      instance.onstart=()=>setListening(true);
      instance.onresult=e=>{setPrompt(e.results[0][0].transcript);promptInput.current?.focus();};
      instance.onerror=e=>{if(e.error!=='aborted')notify('Voice input was unavailable. Type your prompt instead.');};
      instance.onend=()=>{recognition.current=null;setListening(false);};
      recognition.current=instance;instance.start();
    }catch{recognition.current=null;setListening(false);notify('Voice input was unavailable. Type your prompt instead.');}
  }
  function importScene(value) {
    if(value.length>160_000)throw new Error('Choose a JSON file smaller than 160 KB.');
    const raw=JSON.parse(value);
    let plan,result;
    if(raw?.mode)result=sceneFromText(value,{presets:true});
    else{plan=parsePlan(value);result=compilePlan(plan,state.current.mode);}
    abortRequest();setFollow(false);applyScene(result,'file',null,false,{plan});setDialog(null);notify(plan?'Scene plan imported.':'Scene imported.','success');
  }
  function exportScene(asPlan=false) {
    const value=asPlan?record.plan:record.scene;
    if(!value)return;
    const blob=new Blob([JSON.stringify(value,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=`${record.scene.title.toLowerCase().replace(/[^a-z\d]+/g,'-').replace(/(^-|-$)/g,'')||'sightline'}-${asPlan?'plan':'scene'}.json`;
    document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1500);setMenu(false);
    notify(asPlan?'Scene plan exported.':'Scene JSON exported.','success');
  }
  function connectModel(config){
    abortRequest();setFollow(false);lastFrame.current=null;
    const scope=isLocalRuntime(config.provider)?'local':'cloud', name=PROVIDERS[config.provider].name;
    setRuntime({...config,scope,name});setDialog(null);notify(`${name} selected. Use Visualize to run the model.`,'success');
  }
  function disconnectModel(){abortRequest();setFollow(false);lastFrame.current=null;setRuntime(null);setDialog(null);notify('Model disconnected. Demos and local tracing still work.');}

  const isLive=source.type==='screen';
  const status=isLive?'Sharing screen':runtime?(runtime.scope==='local'?'Local model':'Cloud model'):source.type==='image'?'Local trace':'Demo mode';
  const scene=record.scene?.mode===mode?record.scene:null;
  const demo=source.type==='demo'&&!runtime;
  function openLab(kind='wind',render=state.current.mode){
    if(state.current.mode===render&&labKind(state.current.record.scene)===kind)return;
    abortRequest();showExample('lab',render,kind);
  }
  const stageProps={scene,mode,source,busy,busyKind:job,sceneOrigin:record.origin,modelLabel:record.modelLabel,elapsed:record.elapsed,sessionIndex:record.index,onFallback:()=>switchMode('2d'),lab:labKind(scene)?lab:null,onLabTab:openLab,tour};
  const chips=labKind(scene)?[
    {label:'Play guided walkthrough',q:'Play the walkthrough.',icon:Layers},
    ...(lab.kind==='wind'?[{label:'Open engine cutaway',action:()=>openLab('engine'),icon:Fan}]:[{label:'Back to wind tunnel',action:()=>openLab('wind'),icon:Wind}]),
  ]:demo ? (example==='pi' ? [
    {label:'Label the components',q:'Label the main components.',icon:Layers},
    {label:'Show camera connection',q:'Show how a camera attaches to a Raspberry Pi 5.',icon:ArrowUpRight},
    {label:'Explain in 2D',q:'Explain this in 2D.',mode:'2d',icon:Workflow},
  ] : example==='tokens' ? [
    {label:'Show training targets',q:'Show next-token training targets.',mode:'2d',icon:Workflow},
    {label:'Make it 3D',q:'Visualize next-token prediction in 3D.',mode:'3d',icon:Box},
  ] : example==='filter' ? [
    {label:'Show the steps',q:'Show the steps of the filter demo.',mode:'2d',icon:Workflow},
    {label:'Make it 3D',q:'Show the filter demo in 3D.',mode:'3d',icon:Box},
  ] : [
    {label:'Show airflow',q:'Show how a fan creates airflow.',icon:Layers},
    {label:'Draw a side view',q:'Draw a 2D side view of a fan.',mode:'2d',icon:Workflow},
  ]) : [
    {label:'Explain this screen',q:'Explain the most important concept visible on the screen.',icon:Layers},
    {label:'Make a 2D diagram',q:'Make a clear 2D diagram of the visible subject.',mode:'2d',icon:Workflow},
    {label:'Show a 3D model',q:'Make a 3D illustration of the main subject.',mode:'3d',icon:Box},
  ];

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><img src="/sightline.svg" alt=""/><div><strong>Sightline<span>.</span></strong><small>VISUAL ENGINE</small></div></div>
      <div className="header-main">
        <div className="breadcrumbs"><PanelTop size={16}/><span>Studio</span><ChevronRight size={13}/><strong>Canvas</strong></div>
        <div className="header-actions">
          <button className={'mode-badge'+(isLive||runtime?' badge-on':'')} type="button" onClick={()=>setDialog({type:'vision'})} title="Model settings"><i/>{status}</button>
          <button className={'primary-btn share-btn'+(isLive?' share-stop':'')} type="button" onClick={shareScreen} disabled={sharing}>{sharing?<LoaderCircle className="spinning" size={16}/>:isLive?<Square size={14}/>:<MonitorUp size={17}/>}<span>{sharing?'Starting…':isLive?'Stop sharing':'Share screen'}</span></button>
          <div className="menu-wrap" ref={menuRef}>
            <button type="button" className="menu-trigger" title="Scene actions" aria-label="Scene actions" aria-expanded={menu} onClick={()=>setMenu(!menu)}><Ellipsis size={20}/></button>
            {menu&&<div className="action-menu">
              <span>SCENE FILE</span>
              <button type="button" onClick={()=>{setMenu(false);setDialog({type:'import'});}}><FileJson size={16}/> Import scene JSON</button>
              <button type="button" onClick={()=>exportScene()} disabled={!scene}><Download size={16}/> Download scene JSON</button>
              {record.plan&&<button type="button" onClick={()=>exportScene(true)}><Workflow size={16}/> Download scene plan</button>}
              <button type="button" onClick={()=>{setMenu(false);floatCanvas();}}><PictureInPicture2 size={16}/> {floating?'Return floating canvas':'Float canvas'}</button>
              <a href={window.location.origin+window.location.pathname} target="_blank" rel="noopener noreferrer" onClick={()=>setMenu(false)}><ArrowUpRight size={16}/> Open in new tab</a>
            </div>}
          </div>
        </div>
      </div>
    </header>
    <Sidebar example={example} source={source} sourceImage={sourceImage} sourceVideo={screenVideo} onSourceReady={onSourceReady}
      onExample={id=>{abortRequest();setPrompt('');showExample(id);}} onUpload={openImagePicker} onVision={()=>setDialog({type:'vision'})}
      onCaptureHelp={()=>setDialog({type:'capture',blocked:false})} onClear={clearSource} follow={follow} onFollow={toggleFollow} runtime={runtime}/>
    <main className="workspace">
      <div className="workspace-inner">
        <div className="workspace-heading">
          <div>
            <div className="eyebrow"><i/> SCREEN-TO-SCENE STUDIO</div>
            <h1>Visual workspace</h1>
            <p>Turn what’s on your screen into interactive visuals.</p>
          </div>
          <div className="workspace-actions">
          {!lab.kind&&source.type==='demo'&&<button type="button" className="lab-launch" aria-label="Open Airflow lab" onClick={()=>{setPrompt('');openLab('wind','3d');}}><Wind size={15}/> Airflow lab <span>LIVE</span></button>}
          <div className="mode-switch" role="group" aria-label="Visualization type">
            <button className={mode==='2d'?'chosen':''} aria-pressed={mode==='2d'} type="button" onClick={()=>switchMode('2d')}><ScanLine size={16}/> 2D Diagram</button>
            <button className={mode==='3d'?'chosen':''} aria-pressed={mode==='3d'} type="button" onClick={()=>switchMode('3d')}><Box size={17}/> 3D Model</button>
          </div>
          </div>
        </div>
        {floating ? <>
          <section className="stage-card floating-placeholder"><div className="paper-stage"><div className="paper-wash"/><div className="empty-canvas"><div><PictureInPicture2 size={25}/></div><strong>Canvas is floating</strong><span>Keep the scene beside the window you’re sharing.</span><button type="button" className="return-float" onClick={()=>floating.window.close()}>Return to studio</button></div></div></section>
          {createPortal(<Stage {...stageProps} floating onCloseFloat={()=>floating.window.close()}/>,floating.container)}
        </> : <Stage {...stageProps}/>}
        <div className="composer">
          <div className="composer-label"><strong><Sparkles size={14}/> DIRECT THE SCENE</strong><span title="Control or Command plus K"><kbd>{navigator.platform?.includes('Mac')?'⌘':'Ctrl'}</kbd><kbd>K</kbd></span></div>
          <form className="prompt-bar" onSubmit={e=>{e.preventDefault();visualize();}}>
            <label className="sr-only" htmlFor="prompt">Visualization prompt</label>
            <input id="prompt" ref={promptInput} type="text" value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder="Ask about what’s on your screen…" maxLength={1000} autoComplete="off"/>
            <button type="button" className={'mic-btn'+(listening?' recording':'')} aria-label={listening?'Stop dictation':'Dictate prompt'} title="Dictate using your browser’s speech service" onClick={dictate}><Mic size={18}/></button>
            <button type="submit" className="primary-btn visualize-btn" disabled={busy}>{busy?'Generating…':'Visualize'}{busy?<LoaderCircle className="spinning" size={15}/>:<ArrowRight size={17}/>}</button>
          </form>
          <div className="suggestions"><span>TRY</span>{chips.map(({label,q,mode:target,icon:Icon,action})=><button key={label} type="button" onClick={action||(()=>{setPrompt(q);visualize({query:q,sceneMode:target});})}><Icon size={13}/>{label}</button>)}</div>
        </div>
      </div>
    </main>
    <input type="file" accept="image/*" aria-label="Upload source image" hidden ref={imageInput} onChange={e=>{loadImage(e.target.files?.[0]);e.target.value='';}}/>
    {toast&&<div className={'toast '+toast.kind} role={toast.kind==='error'?'alert':'status'}>{toast.kind==='success'?<CircleCheck size={17}/>:<span className="toast-dot"/>}<span>{toast.text}</span><button type="button" aria-label="Dismiss notification" onClick={()=>setToast(null)}><X size={15}/></button></div>}
    {dialog?.type==='vision'&&<ModelDialog runtime={runtime} onClose={()=>setDialog(null)} onConnect={connectModel} onDisconnect={disconnectModel}/>}
    {dialog?.type==='capture'&&<CaptureDialog blocked={dialog.blocked} reason={dialog.reason} onUpload={openImagePicker} onClose={()=>setDialog(null)}/>}
    {dialog?.type==='import'&&<ImportDialog onImport={importScene} onClose={()=>setDialog(null)}/>}
  </div>;
}
