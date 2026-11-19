import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Focus, Layers, LoaderCircle, Maximize, Minus, Mouse, MousePointer2, Pause, Play, Plus, ScanLine, Tags, X } from 'lucide-react';
import { Scene2D, Scene3D } from './graphics.jsx';
import { AeroLegend, AeroMetrics, LabRail } from './AeroLab.jsx';

export function StreamVideo({stream, videoRef, ...props}) {
  const local=useRef(null);
  const ref=videoRef||local;
  useEffect(()=>{
    const v=ref.current;
    if(!v || !stream)return;
    v.srcObject=stream;
    v.play().catch(()=>{});
    return ()=>{v.pause();v.srcObject=null;};
  },[stream,ref]);
  return <video autoPlay muted playsInline ref={ref} {...props}/>;
}

function Axes() {
  return <svg viewBox="0 0 66 48" className="axes" aria-hidden="true">
    <path d="M28 32 47 38M28 32 12 38M28 32V11" fill="none" stroke="#9ba99e" strokeWidth="1.3"/>
    <path d="M28 32 47 38" stroke="#a87560" strokeWidth="1.5"/><path d="M28 32 12 38" stroke="#638b85" strokeWidth="1.5"/><path d="M28 32V11" stroke="#70926c" strokeWidth="1.5"/>
    <circle cx="28" cy="32" r="2.5" fill="#7d8f81"/><circle cx="47" cy="38" r="2.1" fill="#b4826d"/><circle cx="12" cy="38" r="2.1" fill="#7ba6a0"/><circle cx="28" cy="11" r="2.1" fill="#87a080"/>
    <text x="51" y="42" fill="#9c6d57">X</text><text x="25" y="7" fill="#62875e">Y</text><text x="2" y="42" fill="#567f78">Z</text>
  </svg>;
}

export default function Stage({scene, mode, source, busy, busyKind, sceneOrigin, modelLabel, elapsed, onFallback, sessionIndex, floating=false, onCloseFloat, lab, onLabTab, tour}) {
  const [labels,setLabels]=useState(true),[guide,setGuide]=useState(true),[overlay,setOverlay]=useState(false),[expanded,setExpanded]=useState(false),[selected,setSelected]=useState(null);
  const controls=useRef(null),tabs=useRef(null),seenTour=useRef(null);
  const [step,setStep]=useState(-1),[playing,setPlaying]=useState(false);
  const isLab=!!lab?.kind, closed=lab?.kind==='engine'&&!lab.engine.section;
  const steps=scene?.story?.steps||[], hasStory=steps.length>0, stepData=steps[step];
  const spotlight=stepData?.focus??null;
  const showLabels=labels&&!closed;
  const canGuide=!!scene?.labels.length||steps.some(s=>s.point);
  const cue=useMemo(()=>{
    if(!guide||closed||!scene)return null;
    if(selected!=null&&showLabels&&scene.labels[selected])return {id:`label-${selected}`,scene:scene.title,at:scene.labels[selected].at,label:selected};
    const target=spotlight!=null?scene.labels[spotlight]:null;
    if(stepData?.point||target)return {id:`step-${step}`,scene:scene.title,at:stepData.point||target.at,label:stepData.point?null:spotlight};
    return null;
  },[scene,guide,closed,selected,showLabels,spotlight,stepData,step]);
  const open=()=>{if(closed)lab.updateEngine({section:true});};
  function go(n){if(n>=0)open();setPlaying(false);setStep(n);setSelected(null);}
  function play(){
    if(playing){setPlaying(false);return;}
    open();setSelected(null);if(step<0||step>=steps.length-1)setStep(0);setPlaying(true);
  }
  function select(n){setSelected(n);if(n!=null)setPlaying(false);}
  useEffect(()=>{setStep(-1);setPlaying(false);},[scene?.title]);
  useEffect(()=>{if(closed){setStep(-1);setPlaying(false);setSelected(null);}},[closed]);
  useEffect(()=>{
    if(!tour||seenTour.current===tour||!hasStory||tour.title!==scene?.title)return;
    seenTour.current=tour;open();setSelected(null);setStep(0);setPlaying(true);
  },[tour,scene?.title,hasStory]);
  useEffect(()=>{
    if(!playing||!hasStory)return;
    const hold=Math.max(2800,Math.min(4650,1600+(stepData?.note?.length||0)*17));
    const t=setTimeout(()=>{if(step+1<steps.length)setStep(step+1);else setPlaying(false);},hold);
    return()=>clearTimeout(t);
  },[playing,step,hasStory,steps.length,stepData]);
  useEffect(()=>{
    const strip=tabs.current, active=strip?.querySelector('[aria-pressed="true"]');
    if(!active||strip.scrollWidth<=strip.clientWidth)return;
    const a=active.getBoundingClientRect(),b=strip.getBoundingClientRect();
    if(a.right>b.right-3)strip.scrollLeft+=a.right-b.right+6;
    else if(a.left<b.left+3)strip.scrollLeft-=b.left-a.left+6;
  },[step,scene?.title]);
  const detail=showLabels&&selected!=null?scene?.labels[selected]:null;
  useEffect(()=>{setSelected(null);},[scene?.title,mode]);
  useEffect(()=>{
    if(!expanded)return;
    const handle=e=>{if(e.key==='Escape')setExpanded(false);};
    const doc=tabs.current?.ownerDocument||document;doc.addEventListener('keydown',handle);return ()=>doc.removeEventListener('keydown',handle);
  },[expanded]);
  const origin=({demo:'Demo scene', AI:'Model plan', recipe:'Engine recipe', trace:'On-device trace', local:'Local engine', file:'Imported scene'})[sceneOrigin] || 'Local renderer';
  return <section className={'stage-card'+(expanded?' is-expanded':'')+(floating?' is-floating':'')+(hasStory?' has-story':'')+(isLab?' is-aero aero-'+lab.kind:'')} aria-label="Visualization canvas">
    <div className={'paper-stage'+(overlay?' overlay-on':'')}>
      {overlay&&<div className="overlay-image" aria-hidden="true">
        {source.type==='screen'?<StreamVideo stream={source.stream}/>:source.url?<img src={source.url} alt=""/>:null}
      </div>}
      <div className="paper-wash" aria-hidden="true"/>
      <div className="stage-heading">
        <div className="scene-index"><span className="index-mark"/>{isLab?(lab.kind==='wind'?'LAB 01':'LAB 02'):`SCENE ${String(sessionIndex).padStart(2,'0')}`}<span className="scene-index-slash">/</span>{mode==='3d'?'3D MODEL':'2D DIAGRAM'}</div>
        <h2>{scene?.title||'Ready to visualize'}</h2>
        <p>{scene?.subtitle||'Share a source or enter a prompt to create a scene.'}</p>
      </div>
      <div className="stage-tools">
        <button className={showLabels&&scene?.labels?.length?'is-active':''} type="button" title={labels?'Hide labels':'Show labels'} aria-label={labels?'Hide labels':'Show labels'} aria-pressed={showLabels} disabled={!scene?.labels?.length||closed} onClick={()=>{setLabels(!labels);setSelected(null);}}><Tags size={15}/></button>
        <button className={guide&&canGuide?'is-guide':''} type="button" title={guide?'Hide guide cursor':'Show guide cursor'} aria-label={guide?'Hide guide cursor':'Show guide cursor'} aria-pressed={guide&&canGuide} disabled={!canGuide} onClick={()=>setGuide(!guide)}><MousePointer2 size={15}/></button>
        <button className={overlay?'is-active':''} type="button" title="Toggle source overlay" aria-label="Toggle source overlay" aria-pressed={overlay} onClick={()=>setOverlay(!overlay)}><Layers size={15}/></button>
        <span className="tool-split"/>
        <button type="button" title={floating?'Return to studio':expanded?'Exit expanded view':'Expand canvas'} aria-label={floating?'Return to studio':expanded?'Exit expanded view':'Expand canvas'} onClick={floating?onCloseFloat:()=>setExpanded(!expanded)}>{expanded||floating?<X size={16}/>:<Maximize size={15}/>}</button>
      </div>
      {scene ? (mode==='3d'?<Scene3D scene={scene} showLabels={showLabels} selected={selected} onSelect={select} cue={cue} lab={isLab?lab:null} controlsRef={controls} step={step} spotlight={spotlight} modeFallback={onFallback} keepView={sceneOrigin==='trace'&&source.type==='screen'}/>:<Scene2D scene={scene} showLabels={showLabels} selected={selected} onSelect={select} cue={cue} lab={isLab?lab:null} controlsRef={controls} step={step} spotlight={spotlight} keepView={sceneOrigin==='trace'&&source.type==='screen'}/>) : <div className="empty-canvas"><div>{mode==='3d'?<Box size={30}/>:<ScanLine size={30}/>}</div><strong>No {mode.toUpperCase()} scene yet</strong><span>Use Visualize to generate one.</span></div>}
      {busy && <div className="stage-busy" role="status"><LoaderCircle size={15}/>{busyKind==='ocr'?'Reading screen text…':busyKind==='local-model'?'Waiting for local model…':'Planning the scene…'}</div>}
      {isLab&&<><AeroMetrics lab={lab}/><AeroLegend lab={lab}/></>}
      <div className="canvas-axes">{mode==='3d'?<Axes/>:<span className="flat-axis"><ScanLine size={19}/> XY</span>}</div>
      {stepData&&!detail&&<div className="story-note" role="status" aria-live="polite"><i>{String(step+1).padStart(2,'0')}</i><div><b>{stepData.title}</b>{stepData.note&&<p>{stepData.note}</p>}</div></div>}
      {detail&&<div className="annotation-detail"><div aria-live="polite"><b>{detail.text}</b><p>{detail.detail||'Annotated point in the current scene.'}</p></div><button type="button" aria-label="Close annotation" onClick={()=>setSelected(null)}><X size={15}/></button></div>}
      <div className="stage-zoom">
        <button type="button" title="Zoom out" aria-label="Zoom out" disabled={!scene} onClick={()=>controls.current?.zoomOut()}><Minus size={16}/></button>
        <button type="button" title="Zoom in" aria-label="Zoom in" disabled={!scene} onClick={()=>controls.current?.zoomIn()}><Plus size={16}/></button>
        <span className="tool-split"/>
        <button type="button" title="Reset view" aria-label="Reset view" disabled={!scene} onClick={()=>controls.current?.reset()}><Focus size={16}/></button>
      </div>
    </div>
    {isLab&&stepData&&!detail&&<div className="aero-note-band" role="status"><i>{String(step+1).padStart(2,'0')}</i><div><b>{stepData.title}</b><p>{stepData.note}</p></div></div>}
    {isLab&&detail&&<div className="aero-note-band"><div aria-live="polite"><b>{detail.text}</b><p>{detail.detail||'Annotated point in the current scene.'}</p></div><button type="button" aria-label="Close annotation" onClick={()=>setSelected(null)}><X size={15}/></button></div>}
    {isLab&&<LabRail lab={lab} onTab={onLabTab}/>}
    {hasStory&&<div className="story-rail" aria-label="Scene walkthrough">
      <button type="button" className="story-play" aria-label={playing?'Pause walkthrough':'Play walkthrough'} title={playing?'Pause walkthrough':'Play walkthrough'} onClick={play}>{playing?<Pause size={14}/>:<Play size={14}/>}</button>
      <span className="story-caption">WALKTHROUGH</span>
      <div className="story-tabs" ref={tabs} role="group" aria-label="Walkthrough steps">
        <button type="button" aria-pressed={step<0} onClick={()=>go(-1)}>Overview</button>
        {steps.map((one,i)=><button type="button" key={i} aria-pressed={step===i} onClick={()=>go(i)}><i>{String(i+1).padStart(2,'0')}</i>{one.title}</button>)}
      </div>
      <span className="story-fraction">{step<0?`${steps.length} STEPS`:`${step+1} / ${steps.length}`}</span>
    </div>}
    <div className="stage-footer">
      <div className="render-status"><i className={busy?'busy-dot':''}/><b>{busy?'Generating':scene?'Scene ready':'Ready'}</b><span className="status-divider"/><span>{isLab?(lab.kind==='wind'?'2D flow model · unitless':'Mechanics illustration'):modelLabel||origin}</span>{!isLab&&scene?.quality==='schematic'&&mode==='3d'&&<span className="annotation-count">· Schematic</span>}{scene&&scene.labels.length>0&&<span className="annotation-count">· {scene.labels.length} annotations</span>}{elapsed!=null&&<span className="render-timing">· {elapsed<1000?`${Math.round(elapsed)} ms`:`${(elapsed/1000).toFixed(1)} s`}</span>}</div>
      <div className="stage-hint"><Mouse size={14}/> <span>{mode==='3d'?'Drag to orbit':'Drag to pan'}<i>·</i>Scroll to zoom</span></div>
    </div>
  </section>;
}
