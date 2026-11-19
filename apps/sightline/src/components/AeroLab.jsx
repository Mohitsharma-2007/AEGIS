import { useEffect, useRef, useState } from 'react';
import { Activity, Fan, Layers, Pause, Play, RotateCcw, Waves, Wind } from 'lucide-react';
import { WIND_DEFAULT } from '../engine/aero/solver.js';
import { ENGINE_DEFAULT, FLOW_FRAME, windToSvg } from '../engine/aero/scenes.js';
import { DOMAIN, worldAt } from '../engine/aero/airframe.js';
import { colorize, FlowParticles, makeTraces } from '../engine/aero/visual-flow.js';

export function useAeroLab(kind){
  const [wind,setWind]=useState(()=>({...WIND_DEFAULT})),[engine,setEngine]=useState(()=>({...ENGINE_DEFAULT})),[stats,setStats]=useState(null),[failure,setFailure]=useState(false);
  const settings=useRef({wind,engine}),field=useRef(null),worker=useRef(null),hist=useRef([]);
  settings.current={wind,engine};
  useEffect(()=>{
    field.current=null;hist.current=[];setStats(null);setFailure(false);
    if(kind!=='wind')return;
    let runner;
    try{runner=new Worker(new URL('../engine/aero/flow.worker.js',import.meta.url),{type:'module'});}catch{setFailure(true);return;}
    worker.current=runner;
    let last=-Infinity,lastTick=0;
    runner.onmessage=e=>{
      if(e.data?.type!=='field')return;
      const f=e.data;field.current=f;
      const clock=performance.now();
      if(f.tick<lastTick){hist.current=[];last=-Infinity;}lastTick=f.tick;
      if(clock-last>131){
        hist.current=[...hist.current,f.drag].slice(-29);last=clock;
        setStats({tick:f.tick,drag:f.drag,peak:f.peak,history:hist.current});
      }
    };
    runner.onerror=()=>setFailure(true);
    runner.postMessage({type:'start',config:settings.current.wind});
    return()=>{runner.terminate();if(worker.current===runner)worker.current=null;field.current=null;};
  },[kind]);
  useEffect(()=>{worker.current?.postMessage({type:'configure',config:wind});},[wind]);
  return {kind,wind,engine,settings,field,stats,failure,updateWind:change=>setWind(x=>({...x,...(typeof change==='function'?change(x):change)})),updateEngine:change=>setEngine(x=>({...x,...change}))};
}
function dial(id,label,value,min,max,display,onChange){return <label className="lab-dial" htmlFor={id}><span>{label}<b>{display}</b></span><input id={id} aria-label={label} aria-valuetext={display} type="range" min={min} max={max} value={value} onChange={e=>onChange(+e.target.value)} style={{'--fill':`${(value-min)/(max-min)*100}%`}}/></label>;}
export function LabRail({lab,onTab}){
  const {kind,wind,engine,updateWind,updateEngine}=lab;
  const windHere=kind==='wind',paused=windHere?wind.paused:engine.paused;
  const pause=()=>windHere?updateWind({paused:!paused}):updateEngine({paused:!paused});
  return <div className="aero-controls" aria-label="Airflow lab controls">
    <div className="aero-tabs" role="group" aria-label="Lab exhibit">
      <button type="button" aria-pressed={windHere} onClick={()=>onTab('wind')}><Wind size={15}/> Wind tunnel</button><button type="button" aria-pressed={!windHere} onClick={()=>onTab('engine')}><Fan size={15}/> Engine cutaway</button>
    </div>
    <div className="lab-tuners">
      {windHere?<>
        {dial('wind-level','Wind speed',wind.speed,12,100,`${wind.speed}%`,v=>updateWind({speed:v}))}
        {dial('wind-angle','Crosswind',wind.cross,-15,15,`${wind.cross}°`,v=>updateWind({cross:v}))}
        <label className="lab-select" title="Displayed flow field"><select aria-label="Field overlay" value={wind.layer} onChange={e=>updateWind({layer:e.target.value})}><option value="speed">Speed field</option><option value="wake">Wake rotation</option><option value="lines">Streamlines</option></select></label>
        <button type="button" className="lab-flag" aria-pressed={wind.gust} onClick={()=>updateWind({gust:!wind.gust})} title="Toggle gust variation"><Waves size={14}/> Gusts</button>
      </>:<>
        {dial('engine-pace','Motion',engine.speed,12,100,`${engine.speed}%`,v=>updateEngine({speed:v}))}
        <button type="button" className="lab-flag" aria-pressed={engine.section} title="Open or close the longitudinal cutaway" onClick={()=>updateEngine({section:!engine.section})}><Layers size={14}/> Cutaway</button>
        <button type="button" className="lab-flag" aria-pressed={engine.paths} onClick={()=>updateEngine({paths:!engine.paths})} title="Toggle rendered airflow paths"><Wind size={14}/> Flow paths</button>
      </>}
      <div className="lab-actions">
        <button type="button" className="lab-toggle" aria-label={paused?'Resume simulation':'Pause simulation'} title={paused?'Resume simulation':'Pause simulation'} onClick={pause}>{paused?<Play size={15}/>:<Pause size={15}/>}</button>
        {windHere&&<button type="button" className="lab-toggle" aria-label="Reset wind solver" title="Reset wind solver" onClick={()=>updateWind(x=>({reset:x.reset+1}))}><RotateCcw size={15}/></button>}
      </div>
    </div>
  </div>;
}
export function AeroMetrics({lab}){
  if(lab.kind!=='wind')return <div className="aero-badge" title="Sectioned illustrative machinery, not a performance simulation"><i className={lab.engine.paused?'idle':''}/><span>{!lab.engine.section?'CASE CLOSED':lab.engine.paused?'MOTION PAUSED':'LIVE CUTAWAY'}</span></div>;
  const data=lab.stats?.history||[],min=Math.max(0,Math.min(...data,1)-.1),max=Math.max(1.3,Math.max(...data,1)+.15);
  const p=data.map((d,i)=>`${(i/Math.max(1,data.length-1))*113},${23-(d-min)/(max-min)*20}`).join(' ');
  return <div className="aero-metric" aria-label="Wind solver readout">
    <div className="aero-metric-top"><Activity size={14}/><span>{lab.failure?'FIELD ERROR':lab.wind.paused?'FIELD PAUSED':!lab.stats?'SOLVER WARMING':'LIVE FLOW'}</span></div>
    <div className="aero-metric-row"><div><small>RELATIVE DRAG</small><strong data-drag-value={lab.stats?.drag??''}>{lab.stats?lab.stats.drag.toFixed(2):'—'}</strong></div><svg viewBox="0 0 113 26" className="drag-spark" aria-hidden="true"><path d="M0 24h113" stroke="#9bb2a490" fill="none"/>{p&&<polyline points={p} fill="none" stroke="#477e72" strokeWidth="1.8" strokeLinecap="round"/>}</svg></div>
    <div className="aero-metric-foot" title="Unitless momentum exchange; not a physical drag coefficient"><span>UNITLESS INDEX</span><span data-field-tick={lab.stats?.tick??0} title="Solver ticks">{lab.stats?String(lab.stats.tick).padStart(4,'0'):'—'}</span></div>
  </div>;
}
export function AeroLegend({lab}){
  if(lab.kind==='engine'&&(!lab.engine.paths||!lab.engine.section))return null;
  if(lab.kind==='engine')return <div className="aero-legend"><span><i className="legend-bypass"/> Bypass air</span><span><i className="legend-core"/> Core path</span></div>;
  return <div className="aero-legend flow-legend"><span className={lab.wind.layer==='wake'?'legend-wake':lab.wind.layer==='lines'?'legend-traces':'legend-speed'}/><span>{lab.wind.layer==='wake'?'Rotation − / +':lab.wind.layer==='lines'?'Integrated flow traces':'Slower → faster'}</span><span className="legend-mini">2D / LBM</span></div>;
}

const COLD=[[[165,247],[328,239],[537,245],[675,255],[836,274]],[[164,343],[305,353],[494,347],[665,329],[830,311]]];
const HOT=[[[247,292],[390,292],[491,297],[607,299],[738,303],[831,302]],[[293,307],[437,305],[579,309],[714,309],[834,307]]];
function interpolate(path,t){
  const i=Math.min(path.length-2,Math.floor(t*(path.length-1))),a=path[i],b=path[i+1],f=t*(path.length-1)-i;
  return [a[0]+(b[0]-a[0])*f,a[1]+(b[1]-a[1])*f];
}
export function AeroField2D({lab,transform,step=-1,force=false}){
  const ref=useRef(null),view=useRef({lab,transform,step,force});view.current={lab,transform,step,force};
  useEffect(()=>{
    const c=ref.current, win=c.ownerDocument.defaultView||window, ctx=c.getContext('2d'), img=c.ownerDocument.createElement('canvas'), off=img.getContext('2d');
    if(!ctx||!off)return;
    const tracers=new FlowParticles(150);
    let raster=null,oldField=null,lastLayer='',past='',strokes=[],id=0,last=0,clock=.52,dirty=true;
    const reduced=win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reserve=()=>{const dpr=Math.min(1.65,win.devicePixelRatio||1),w=Math.round(c.clientWidth*dpr),h=Math.round(c.clientHeight*dpr);const changed=c.width!==w||c.height!==h;if(changed){c.width=w;c.height=h;}return changed;};
    const ro=new ResizeObserver(()=>{dirty=true;});ro.observe(c);
    function frame(t){
      id=win.requestAnimationFrame(frame);
      const dt=Math.min(.06,Math.max(0,(t-(last||t))/1000));last=t;
      const {lab,transform:tr,step,force}=view.current, wind=lab.kind==='wind', cfg=wind?lab.wind:lab.engine,f=lab.field.current;
      const current=`${tr.k}|${tr.x}|${tr.y}|${cfg.layer}|${cfg.paused}|${cfg.paths}|${cfg.section}|${step}`;
      if(!dirty&&past===current&&oldField===f&&(cfg.paused||reduced))return;
      reserve();dirty=false;past=current;
      ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,c.width,c.height);
      const k=Math.min(c.width/1000,c.height/500);
      if(wind&&!f?.data)return;
      ctx.save();ctx.beginPath();ctx.rect(c.width/2-500*k,c.height/2-250*k,1000*k,500*k);ctx.clip();
      ctx.translate(c.width/2+tr.x*k,c.height/2+tr.y*k);ctx.scale(k*tr.k,k*tr.k);ctx.translate(-500,-250);
      if(!cfg.paused&&!reduced)clock+=dt;
      if(wind){
        const {x,y,w,h}=FLOW_FRAME;
        if(force){
          if(step===2){
            const [a,b]=windToSvg(.58,0), length=40+Math.min(96,f.drag*30);
            ctx.strokeStyle='#fff8ed';ctx.lineWidth=6.4;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(a,b);ctx.lineTo(a+length,b);ctx.stroke();
            ctx.strokeStyle='#ad5e46';ctx.lineWidth=3.6;ctx.stroke();ctx.fillStyle='#ad5e46';ctx.beginPath();ctx.moveTo(a+length+8,b);ctx.lineTo(a+length-6,b-6);ctx.lineTo(a+length-6,b+6);ctx.closePath();ctx.fill();
          }
          oldField=f;ctx.restore();return;
        }
        if(oldField!==f||lastLayer!==cfg.layer){
          const inPaths=new Path2D(),wakePaths=new Path2D();
          for(const trace of makeTraces(f,26,9)){
            const path=trace.upstream?inPaths:wakePaths, [first,...points]=trace.points;
            path.moveTo(...windToSvg(first[2],first[3]));for(const pt of points)path.lineTo(...windToSvg(pt[2],pt[3]));
          }
          strokes=[[inPaths,'#427f7580',1.1],[wakePaths,'#537e9a72',1.28]];
          if(img.width!==f.nx||img.height!==f.ny){img.width=f.nx;img.height=f.ny;raster=off.createImageData(f.nx,f.ny);}
          if(cfg.layer!=='lines'){colorize(f,cfg.layer,raster.data,.90,true);off.putImageData(raster,0,0);}
          oldField=f;lastLayer=cfg.layer;
        }
        ctx.save();ctx.beginPath();ctx.roundRect(x,y,w,h,10);ctx.clip();ctx.fillStyle='#dae7dd60';ctx.fillRect(x,y,w,h);
        if(cfg.layer!=='lines'){ctx.imageSmoothingEnabled=true;const y0=(FLOW_FRAME.minZ-DOMAIN.minZ)/(DOMAIN.maxZ-DOMAIN.minZ)*f.ny, sy=(FLOW_FRAME.maxZ-FLOW_FRAME.minZ)/(DOMAIN.maxZ-DOMAIN.minZ)*f.ny;ctx.drawImage(img,0,y0,f.nx,sy,x,y,w,h);}
        for(const [path,ink,width] of strokes){ctx.strokeStyle=ink;ctx.lineWidth=width;ctx.stroke(path);}
        const points=tracers.move(f,(!cfg.paused&&!reduced)?dt:0);
        for(let j=0;j<points.length;j+=3){
          const [px,py]=windToSvg(...worldAt(points[j],points[j+1],f.nx,f.ny));
          ctx.fillStyle=j%15===0?'#527e9d':'#3b8a7e';ctx.beginPath();ctx.arc(px,py,j%15===0?1.6:1.8,0,Math.PI*2);ctx.fill();
        }ctx.restore();
      }else if(cfg.section&&cfg.paths){
        for(const [lines,color] of [[COLD,'#499f94'],[HOT,'#d69469']])for(const [i,path] of lines.entries()){
          ctx.fillStyle=color;
          for(let j=0;j<9;j++){
            const phase=(clock*(.32+cfg.speed*.0031)+j/9+i*.145)%1;
            const [x,y]=interpolate(path,phase);ctx.beginPath();ctx.arc(x,y,2.25,0,Math.PI*2);ctx.fill();
          }
        }
      }
      ctx.restore();
    }
    id=win.requestAnimationFrame(frame);
    return()=>{win.cancelAnimationFrame(id);ro.disconnect();};
  },[]);
  return <canvas ref={ref} className={'aero-field-canvas'+(lab.kind==='engine'?' engine-field':'')} aria-label={force?'Downwind drag direction':lab.kind==='wind'?'Live layer of computed flow and tracers':'Animated core and bypass paths'} role="img"/>;
}
