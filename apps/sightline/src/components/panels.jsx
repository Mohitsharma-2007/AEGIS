import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, ChevronRight, CircleHelp, CodeXml, Cpu, FileImage, FlaskConical, Focus, ImagePlus, Monitor, Network, Radio, Settings2, Shield, Upload, Waves, Wind, X } from 'lucide-react';
import { EXAMPLES } from '../engine/examples.js';
import { StreamVideo } from './Stage.jsx';

const sampleIcon={pi:Cpu,tokens:Network,fan:Wind,lab:FlaskConical,filter:Waves};
export function Sidebar({example,source,sourceImage,sourceVideo,onSourceReady,onExample,onUpload,onVision,onCaptureHelp,onClear,follow,onFollow,runtime}) {
  const live=source.type==='screen', sample=source.type==='demo', imported=source.type==='image';
  return <aside className="sidebar" aria-label="Sources and examples">
    <div className="sidebar-top">
      <div className="section-label"><span>SOURCE</span><Monitor size={13}/></div>
      <div className="source-card">
        <div className="source-window"><i/><i/><i/><span>{sample?'SAMPLE INPUT':live?'SCREEN SHARING':'IMAGE INPUT'}</span>{live&&<b className="live-mini"/>}</div>
        <div className={'source-preview'+(sample?' example-preview':'')}>
          {live?<StreamVideo stream={source.stream} videoRef={sourceVideo} onLoadedData={onSourceReady} aria-label="Shared screen preview"/>:
            <img src={source.url} alt={sample?`${source.name} sample source`:'Uploaded source preview'} ref={sourceImage} onLoad={onSourceReady}/>}
        </div>
        <div className="source-caption"><div className={'source-icon'+(sample?' sample-source':'')}>{imported?<FileImage size={15}/>:<Monitor size={15}/>}</div>
          <div className="source-caption-text"><strong title={source.name}>{source.name}</strong><small>{sample?'Example source':live?'Sharing with Sightline':'Local image'}</small></div>
          {sample?<span className="source-indicator" title="Sample source"/>:<button type="button" className="clear-source" title={live?'Stop screen sharing':'Remove image'} aria-label={live?'Stop screen sharing':'Remove image'} onClick={onClear}><X size={14}/></button>}
        </div>
      </div>
      <button type="button" className="sidebar-upload" onClick={onUpload}><ImagePlus size={15}/> <span>Upload image</span><span className="upload-plus">+</span></button>
      <div className="follow-row">
        <span><Radio size={15}/> Follow changes</span>
        <button type="button" role="switch" aria-label="Follow screen changes" aria-checked={follow} className={'switch'+(follow?' on':'')} title={live?(runtime?'Send changed content to the selected model':'Trace screen changes locally'):'Share a screen to follow live changes'} onClick={onFollow}><i/></button>
      </div>
      <div className="side-rule"/>
      <div className="section-label scene-label"><span>EXAMPLE SCENES</span><span className="example-count">{String(EXAMPLES.length).padStart(2,'0')}</span></div>
      <div className="example-list">
        {EXAMPLES.map(item=>{const Icon=sampleIcon[item.id];return <button key={item.id} type="button" className={'example-button'+(example===item.id&&sample?' selected':'')+(item.id==='lab'?' lab-example':'')} aria-pressed={example===item.id&&sample} onClick={()=>onExample(item.id)}>
          <span className="example-icon"><Icon size={16}/></span><span className="example-text"><b>{item.name}{item.id==='lab'&&<em>LIVE</em>}</b><small>{item.kind}</small></span><ChevronRight size={14} className="example-chevron"/>
        </button>;})}
      </div>
    </div>
    <div className="sidebar-bottom">
      <button className="settings-link" type="button" onClick={onVision}><Settings2 size={17}/><span>Model settings</span>{runtime?<span className="source-indicator connected"/>:<ChevronRight size={14}/>}</button>
      <div className="privacy"><Shield size={13}/> <span>{runtime?`${runtime.scope==='local'?'Local':'Cloud'} · ${runtime.name}`:'Local rendering'}</span><button type="button" title="About screen capture" aria-label="About screen capture" onClick={onCaptureHelp}><CircleHelp size={13}/></button></div>
    </div>
  </aside>;
}

export function Modal({title,eyebrow,icon:Icon,children,onClose,wide=false}) {
  const ref=useRef(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement;
    const modal=ref.current;modal?.focus();
    const handler=e=>{
      if(e.key==='Escape'){e.stopPropagation();closeRef.current();}
      else if(e.key==='Tab'&&modal){
        const opts=[...modal.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),summary, a[href]')].filter(el=>el.getClientRects().length>0);
        if(!opts.length)return;
        if(e.shiftKey&&(document.activeElement===opts[0]||document.activeElement===modal)){e.preventDefault();opts.at(-1)?.focus();}
        else if(!e.shiftKey&&document.activeElement===opts.at(-1)){e.preventDefault();opts[0]?.focus();}
      }
    };
    document.addEventListener('keydown',handler);
    return()=>{document.removeEventListener('keydown',handler);if(previous instanceof HTMLElement)previous.focus();};
  },[]);
  return <div className="modal-shade" onClick={e=>{if(e.currentTarget===e.target)onClose();}}>
    <div className={'modal'+(wide?' modal-wide':'')} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}>
      <button className="close-modal" type="button" aria-label="Close dialog" onClick={onClose}><X size={19}/></button>
      <div className="modal-icon"><Icon size={22}/></div>
      <span className="modal-kicker">{eyebrow}</span><h2>{title}</h2>{children}
    </div>
  </div>;
}

export function CaptureDialog({blocked,reason,onUpload,onClose}) {
  const url=window.location.origin + window.location.pathname;
  return <Modal title={blocked?'Open Sightline in a new tab':'Sharing your screen'} eyebrow="CAPTURE PERMISSION" icon={Focus} onClose={onClose}>
    <p>{blocked?(reason==='float'?'Floating view needs its own browser tab. Open Sightline directly, then choose Float canvas from the scene menu.':'This embedded preview can’t request display capture. Open Sightline in a browser tab, then choose Share screen. You can still upload an image here.'):'Choose Share screen and select a tab or window in the browser picker. Sightline only sees what you choose, and you can stop sharing at any time.'}</p>
    <div className="tip-box"><Shield size={17}/><span>By default, layout tracing runs locally. A connected model receives a resized image or extracted text only when you use Visualize or enable Follow changes.</span></div>
    <div className="modal-buttons"><button type="button" className="quiet-btn" onClick={onUpload}><Upload size={15}/> Upload image</button><a className="primary-btn" href={url} target="_blank" rel="noopener noreferrer">Open in new tab <ArrowUpRight size={16}/></a></div>
  </Modal>;
}

export function ImportDialog({onImport,onClose}) {
  const [value,setValue]=useState(''),[error,setError]=useState('');
  const input=useRef(null);
  function doImport(){try{onImport(value);}catch(e){setError(e instanceof SyntaxError?'This isn’t valid JSON. Check the text and try again.':e.message);}}
  return <Modal title="Import a scene" eyebrow="SCENE FORMAT" icon={CodeXml} onClose={onClose}>
    <p>Open an exported scene or model plan, or paste your own declarative JSON. It’s rendered locally and never executed as code.</p>
    <label htmlFor="scene-json" className="sr-only">Scene JSON</label><textarea id="scene-json" value={value} onChange={e=>{setValue(e.target.value);setError('');}} placeholder={'{ "mode": "3d", "title": "My scene", "items": […] }'} rows={5}/>
    <input type="file" hidden ref={input} accept=".json,application/json" onChange={async e=>{const f=e.currentTarget.files?.[0];if(f&&f.size<=160000){setValue(await f.text());setError('');}else if(f)setError('Choose a JSON file smaller than 160 KB.');e.target.value='';}}/>
    {error&&<p className="form-error" role="alert">{error}</p>}
    <div className="modal-buttons"><button type="button" className="quiet-btn" onClick={()=>input.current?.click()}><Upload size={15}/> Choose JSON file</button><button type="button" className="primary-btn" disabled={!value.trim()} onClick={doImport}>Import scene <ArrowUpRight size={15}/></button></div>
  </Modal>;
}
