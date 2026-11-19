import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import * as T from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildModel, disposeModel } from '../engine/models.js';
import { GuideLayer, projectGuide } from './Guide.jsx';
import { AeroField2D } from './AeroLab.jsx';

const W=1000,H=500;
function fallbackAnchor(i,n) {
  const col=i%2, row=Math.floor(i/2), total=Math.ceil(n/2);
  return [col ? .85 : .15, total===1 ? .54 : .30+row*.48/(total-1)];
}
function placeLabels(host, nodes, labels, project, max=Infinity) {
  const {clientWidth:w,clientHeight:h}=host;
  if(!w||!h) return;
  labels.forEach((label,i) => {
    const btn=nodes.current.buttons[i], line=nodes.current.lines[i];
    if(!btn || !line) return;
    const [u,v]=label.anchor || fallbackAnchor(i,labels.length);
    const [px,py,ok]=project(label.at,w,h,i);
    if(i>max||!ok||px<4 || px>w-4 || py<4 || py>h-4) {btn.style.visibility='hidden';line.setAttribute('visibility','hidden');return;}
    const hw=btn.offsetWidth/2, hh=btn.offsetHeight/2, pad=w<570?8:18;
    let lx=Math.max(hw+pad,Math.min(w-hw-pad,u*w)), ly=Math.max(hh+16,Math.min(h-hh-30,v*h));
    if (w<550 && v<.26) {ly=Math.max(112, v*h);if (u>.62) lx=w-hw-pad;}
    btn.style.left=`${lx}px`; btn.style.top=`${ly}px`; btn.style.visibility='visible';
    const dx=px-lx,dy=py-ly;
    let ax,ay,mx,my;
    if (Math.abs(dx)/Math.max(hw,1) > Math.abs(dy)/Math.max(hh,1)) {
      ax=lx+Math.sign(dx)*hw; ay=ly; mx=ax+Math.sign(dx)*Math.min(18,Math.abs(dx)*.26); my=ay;
    } else {
      ax=lx; ay=ly+Math.sign(dy)*hh; mx=ax; my=ay+Math.sign(dy)*Math.min(16,Math.abs(dy)*.26);
    }
    line.setAttribute('visibility','visible');
    line.children[0].setAttribute('d',`M ${ax} ${ay} L ${mx} ${my} L ${px} ${py}`);
    for (const dot of [line.children[1],line.children[2]]) {dot.setAttribute('cx',px);dot.setAttribute('cy',py);}
  });
}

function Callouts({labels,nodes,selected,spotlight,onSelect}) {
  const lit=selected??spotlight;
  return <div className="callout-layer" aria-label="Scene annotations">
    <svg className="leader-layer" aria-hidden="true">
      {labels.map((label,i)=><g key={i} ref={el=>nodes.current.lines[i]=el} visibility="hidden" className={i===lit?'picked':lit!=null?'deem':''}>
        <path className="leader-path"/><circle r="4.55" className="leader-halo"/><circle r="2.2" className="leader-point"/>
      </g>)}
    </svg>
    {labels.map((label,i)=><button type="button" title={label.detail||label.text} key={i} ref={el=>nodes.current.buttons[i]=el}
      className={'callout'+(i===lit?' picked':lit!=null?' deem':'')} onClick={()=>onSelect(i===selected?null:i)} aria-pressed={i===selected} style={{visibility:'hidden'}}>
      <span>{String(i+1).padStart(2,'0')}</span>{label.text}
    </button>)}
  </div>;
}

function viewAngle(scene) {
  if (scene.view==='wind') return new T.Vector3(-2.48,9.8,13.2).normalize();
  if (scene.view==='turbofan') return new T.Vector3(-3.35,4.0,14.9).normalize();
  if (scene.view==='fan') return new T.Vector3(8.4,4.6,13).normalize();
  if (scene.view==='camera') return new T.Vector3(8.5,8.9,12.75).normalize();
  if (scene.view==='pcb') return new T.Vector3(8.4,10.4,13.6).normalize();
  return new T.Vector3(7.5,8,13).normalize();
}

export function Scene3D({scene, showLabels, selected, onSelect, controlsRef,modeFallback,keepView=false,step=-1,spotlight=null,cue=null,lab=null}) {
  const host=useRef(null), api=useRef(null), nodes=useRef({lines:[],buttons:[]}), guide=useRef({}), latest=useRef({scene,showLabels,step,cue,lab});
  const [error,setError]=useState(false);
  latest.current={scene,showLabels,step,cue,lab};
  useEffect(()=>{
    const dom=host.current;if(!dom)return;
    let renderer;
    try {renderer=new T.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});} catch {setError(true);return;}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,1.65));
    renderer.setClearColor(0,0);
    renderer.outputColorSpace=T.SRGBColorSpace;
    renderer.toneMapping=T.ACESFilmicToneMapping;
    renderer.toneMappingExposure=1.13;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
    renderer.shadowMap.autoUpdate=false;
    renderer.domElement.className='webgl-surface';
    renderer.domElement.setAttribute('aria-label','Interactive 3D scene');
    renderer.domElement.setAttribute('role','img');
    dom.prepend(renderer.domElement);

    const world=new T.Scene(), cam=new T.OrthographicCamera(-8,8,5,-5,.1,240);
    let envMap;
    try {const pmrem=new T.PMREMGenerator(renderer), room=new RoomEnvironment(); envMap=pmrem.fromScene(room,.04);world.environment=envMap.texture;world.environmentIntensity=.73;room.dispose();pmrem.dispose();} catch { /* direct lights also work */ }
    world.add(new T.HemisphereLight(0xf1f7f4,0xa7b29d,1.65));
    const key=new T.DirectionalLight(0xfff5e4,2.35);key.position.set(-3,10,5);key.castShadow=true;
    key.shadow.mapSize.set(1024,1024);key.shadow.bias=-.00017;key.shadow.normalBias=.025;key.shadow.radius=3.1;
    world.add(key,key.target);
    const fill=new T.DirectionalLight(0xe1f1ff,1.06);fill.position.set(5,4,-6);world.add(fill);
    const rim=new T.DirectionalLight(0xe8f4db,.42);rim.position.set(3,2,8);world.add(rim);
    const floor=new T.Mesh(new T.PlaneGeometry(1,1),new T.ShadowMaterial({opacity:.19,depthWrite:false}));floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;world.add(floor);
    const controls=new OrbitControls(cam,renderer.domElement);
    controls.enableDamping=true;controls.dampingFactor=.12;controls.rotateSpeed=.73;controls.zoomSpeed=.78;controls.enablePan=true;
    controls.minZoom=.45;controls.maxZoom=3.2;controls.maxPolarAngle=Math.PI*.82;
    controls.mouseButtons={LEFT:T.MOUSE.ROTATE,MIDDLE:T.MOUSE.DOLLY,RIGHT:T.MOUSE.PAN};
    controls.touches={ONE:T.TOUCH.ROTATE,TWO:T.TOUCH.DOLLY_PAN};
    const owner=dom.ownerDocument,win=owner.defaultView||window;
    let dirty=true, raf=0, model=null, frustumH=10, time=0, prevTitle='', lastW=0,lastH=0,prevStep=-2,shadowTick=0;
    const v=new T.Vector3();
    function labelLayout() {
      if(!latest.current.showLabels&&!latest.current.cue&&!guide.current.motion?.visible)return;
      cam.updateMatrixWorld();
      const project=(at,w,h,i)=>{
        v.set(...at);if(i!=null)model?.state.labelOffset?.(i,v);v.project(cam);
        return [(v.x*.5+.5)*w,(.5-v.y*.5)*h,v.z>=-1&&v.z<=1];
      };
      if(latest.current.showLabels)placeLabels(dom,nodes,latest.current.scene.labels,project,model?.state.staged&&prevStep>=0?prevStep:Infinity);
      projectGuide(dom,guide,latest.current.cue,project);
    }
    function resize() {
      const w=dom.clientWidth,h=dom.clientHeight;
      if(!w||!h)return;
      if(w!==lastW || h!==lastH){renderer.setSize(w,h,false);lastW=w;lastH=h;}
      cam.left=-frustumH*w/h/2;cam.right=frustumH*w/h/2;cam.top=frustumH/2;cam.bottom=-frustumH/2;
      cam.updateProjectionMatrix();dirty=true;
    }
    function fit() {
      if(!model || model.box.isEmpty()) return;
      const bbox=model.box, s=bbox.getSize(new T.Vector3()), c=bbox.getCenter(new T.Vector3());
      const angle=viewAngle(latest.current.scene);
      controls.target.copy(c);cam.zoom=1;
      cam.position.copy(c).addScaledVector(angle,Math.max(13,s.length()*2.15));cam.up.set(0,1,0);cam.lookAt(c);cam.updateMatrixWorld();
      const mat=cam.matrixWorldInverse;
      let sx=0,sy=0;
      for (const x of [bbox.min.x,bbox.max.x])for(const y of [bbox.min.y,bbox.max.y])for(const z of [bbox.min.z,bbox.max.z]) {
        v.set(x,y,z).applyMatrix4(mat);sx=Math.max(sx,Math.abs(v.x));sy=Math.max(sy,Math.abs(v.y));
      }
      const aspect=Math.max(.45,dom.clientWidth/Math.max(1,dom.clientHeight));
      const narrow=dom.clientWidth<630;
      frustumH=Math.max(1.3, sy*2*(narrow?1.70:1.38), sx*2/aspect*(narrow?1.34:1.29));
      if(latest.current.scene.view==='pcb'&&!narrow)frustumH*=.925;
      if(latest.current.scene.view==='wind')frustumH*=narrow?.93:.94;
      if(latest.current.scene.view==='turbofan')frustumH*=narrow?.91:.88;
      c.y+=frustumH*.008; // Keep a little more breathing room beneath the hero.
      controls.target.copy(c);cam.position.copy(c).addScaledVector(angle,Math.max(13,s.length()*2.15));
      controls.update();resize();
    }
    function render(now) {
      raf=win.requestAnimationFrame(render);
      const shifted=controls.update();
      const gap=now-(time||now);
      if(latest.current.lab&&!shifted&&!dirty&&gap<26)return;
      const dt=Math.max(0,Math.min(.075,gap/1000));time=now;
      const at=latest.current.step;
      if(prevStep!==at){prevStep=at;model?.setStory(at);renderer.shadowMap.needsUpdate=true;dirty=true;}
      if(model?.animations.length&&!owner.hidden){
        let moved=false;
        for(const anim of model.animations)if(anim(dt,at))moved=true;
        if(moved){dirty=true;if(model.state.movingShadows&&(shadowTick++%3===0))renderer.shadowMap.needsUpdate=true;}
      }
      if (!dirty && !shifted) return;
      renderer.render(world,cam);
      labelLayout();dirty=false;
    }
    function setScene(next, keep) {
      if(model){world.remove(model.root);disposeModel(model.root);}
      model=buildModel(next,{lab:latest.current.lab});world.add(model.root);
      const c=model.box.getCenter(new T.Vector3()), s=model.box.getSize(new T.Vector3()), span=Math.max(2.5,s.length()*.90);
      floor.position.set(c.x,model.box.min.y-.08,c.z);floor.scale.set(span*6,span*6,1);
      key.position.set(c.x-span*.36,c.y+span*1.06,c.z+span*.65);key.target.position.copy(c);
      Object.assign(key.shadow.camera,{left:-span,right:span,top:span,bottom:-span,near:.01,far:span*4.6});key.shadow.camera.updateProjectionMatrix();
      if(!keep || next.title!==prevTitle) fit();
      prevTitle=next.title;prevStep=-2;shadowTick=0;
      renderer.shadowMap.needsUpdate=true;dirty=true;
    }
    function zoom(factor){cam.zoom=T.MathUtils.clamp(cam.zoom*factor,.45,3.2);cam.updateProjectionMatrix();controls.update();dirty=true;}
    const handleResize = () => {if(dom.clientWidth!==lastW || dom.clientHeight!==lastH)fit();else resize();};
    const resizeObs=new ResizeObserver(handleResize);resizeObs.observe(dom);
    controls.addEventListener('change',()=>{dirty=true;});
    const onLost=(e)=>{e.preventDefault();if(guide.current.motion?.raf)win.cancelAnimationFrame(guide.current.motion.raf);guide.current.motion=null;setError(true);};
    const onRestored=()=>{setError(false);renderer.shadowMap.needsUpdate=true;dirty=true;};
    renderer.domElement.addEventListener('webglcontextlost',onLost);
    renderer.domElement.addEventListener('webglcontextrestored',onRestored);
    api.current={setScene,dirty:()=>{dirty=true;}};
    controlsRef.current={zoomIn:()=>zoom(1.2),zoomOut:()=>zoom(1/1.2),reset:fit};
    resize();raf=win.requestAnimationFrame(render);
    return ()=>{
      win.cancelAnimationFrame(raf);if(guide.current.motion?.raf)win.cancelAnimationFrame(guide.current.motion.raf);guide.current.motion=null;resizeObs.disconnect();controls.dispose();api.current=null;controlsRef.current=null;
      renderer.domElement.removeEventListener('webglcontextlost',onLost);renderer.domElement.removeEventListener('webglcontextrestored',onRestored);
      if(model)disposeModel(model.root);
      floor.geometry.dispose();floor.material.dispose();key.shadow.dispose();envMap?.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();
    };
  },[controlsRef]);
  useEffect(()=>{ api.current?.setScene(scene,keepView); },[scene,keepView]);
  useLayoutEffect(()=>{ api.current?.dirty(); },[showLabels,selected,step,spotlight,cue,lab?.engine.section,error]);
  return <div className="drawing-host scene3d" ref={host}>
    {showLabels&&!error&&<Callouts labels={scene.labels} nodes={nodes} selected={selected} spotlight={spotlight} onSelect={onSelect}/>}
    {!error&&<GuideLayer motion={guide}/>}
    {error&&<div className="webgl-error"><strong>3D needs WebGL 2</strong><p>Use the 2D renderer if hardware acceleration is unavailable.</p><button type="button" onClick={modeFallback}>Switch to 2D</button></div>}
  </div>;
}

function Item({item: i}) {
  const style=i.opacity!=null?{opacity:i.opacity}:undefined;
  if(i.type==='rect')return <rect x={i.x} y={i.y} width={i.w} height={i.h} rx={i.radius??8} fill={i.fill} stroke={i.stroke} strokeWidth={i.sw} style={style}/>;
  if(i.type==='ellipse')return <ellipse cx={i.x} cy={i.y} rx={i.w/2} ry={i.h/2} fill={i.fill} stroke={i.stroke} strokeWidth={i.sw} style={style}/>;
  if(i.type==='poly'){
    const args={points:i.points.map(p=>p.join(',')).join(' '),fill:i.fill,stroke:i.stroke,strokeWidth:i.sw,strokeLinecap:'round',strokeLinejoin:'round',style};
    return i.fill==='none'?<polyline {...args}/>:<polygon {...args}/>;
  }
  if(i.type==='text')return <text x={i.x} y={i.y} fill={i.fill} textAnchor={i.align} fontSize={i.size} fontWeight={i.weight} className={i.hand?'svg-hand':i.mono?'svg-mono':''} style={style}>{i.text}</text>;
  if(i.type==='line'||i.type==='arrow'){
    const [x,y]=i.to, dx=x-i.x,dy=y-i.y, n=Math.max(.001,Math.hypot(dx,dy)),t=Math.min(n*.38,Math.max(7,i.sw*3.1));
    const vx=dx/n,vy=dy/n;
    return <g style={style}><line x1={i.x} y1={i.y} x2={x-(i.type==='arrow'?t*.4:0)*vx} y2={y-(i.type==='arrow'?t*.4:0)*vy} stroke={i.stroke} strokeWidth={i.sw} strokeLinecap="round" strokeDasharray={i.dash?'6 6':undefined}/>{i.type==='arrow'&&<path d={`M ${x} ${y} L ${x-vx*t+vy*t*.49} ${y-vy*t-vx*t*.49} L ${x-vx*t-vy*t*.49} ${y-vy*t+vx*t*.49} Z`} fill={i.stroke}/>}</g>;
  }
  return null;
}

export function Scene2D({scene,showLabels,selected,onSelect,controlsRef,keepView=false,step=-1,spotlight=null,cue=null,lab=null}) {
  const [transform,setTransform]=useState({x:0,y:0,k:1});
  const host=useRef(null), nodes=useRef({lines:[],buttons:[]}), drag=useRef(null), guide=useRef({});
  const clip=useId();
  useEffect(()=>{if(!keepView)setTransform({x:0,y:0,k:1});},[scene.title,keepView]);
  useLayoutEffect(()=>{
    const dom=host.current;if(!dom)return;
    const project=(at,w,h)=>{
      const s=Math.min(w/W,h/H), x=(at[0]-W/2)*transform.k+transform.x, y=(at[1]-H/2)*transform.k+transform.y;
      return [w/2+x*s,h/2+y*s,Math.abs(x)<=W/2&&Math.abs(y)<=H/2];
    };
    const update=()=>{
      if(showLabels)placeLabels(dom,nodes,scene.labels,project);
      projectGuide(dom,guide,cue,project);
    };
    update();const obs=new ResizeObserver(update);obs.observe(dom);return ()=>obs.disconnect();
  },[scene,showLabels,transform,cue]);
  useEffect(()=>()=>{const m=guide.current.motion;if(m?.raf)m.win.cancelAnimationFrame(m.raf);guide.current.motion=null;},[]);
  useEffect(()=>{
    const dom=host.current;
    const zoom=(d)=>setTransform(v=>({...v,k:Math.max(.55,Math.min(3,v.k*d))}));
    controlsRef.current={zoomIn:()=>zoom(1.18),zoomOut:()=>zoom(1/1.18),reset:()=>setTransform({x:0,y:0,k:1})};
    const wheel=e=>{if(e.target?.closest('button'))return;e.preventDefault();zoom(e.deltaY<0?1.11:1/1.11);};
    dom.addEventListener('wheel',wheel,{passive:false});return ()=>{controlsRef.current=null;dom.removeEventListener('wheel',wheel);};
  },[controlsRef]);
  const sectionClosed=lab?.kind==='engine'&&!lab.engine.section;
  const items=sectionClosed?[{type:'rect',x:164,y:203,w:673,h:189,radius:55,fill:'#a9c0b5',stroke:'#73998c',sw:3},{type:'ellipse',x:196,y:298,w:52,h:172,fill:'#62867b',stroke:'#d7e3d9',sw:5},{type:'line',x:229,y:257,to:[796,270],stroke:'#cedfd4',sw:4},{type:'line',x:230,y:341,to:[797,326],stroke:'#6b998b',sw:2},{type:'text',x:511,y:308,text:'CLOSED NACELLE',mono:true,align:'middle',size:15,fill:'#385c51',weight:650}]:lab?.kind==='engine'&&!lab.engine.paths?scene.items.filter(i=>i.type!=='arrow'):scene.items;
  return <div className="drawing-host scene2d" ref={host}>
    {lab?.kind==='wind'&&<AeroField2D key="wind" lab={lab} transform={transform} step={step}/>}
    <svg className="svg-surface" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" aria-label="Interactive 2D diagram" role="img"
      onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);const dom=host.current;drag.current={x:e.clientX,y:e.clientY,tx:transform.x,ty:transform.y,s:Math.min(dom.clientWidth/W,dom.clientHeight/H)};}}
      onPointerMove={e=>{const d=drag.current;if(!d)return;setTransform(v=>({...v,x:d.tx+(e.clientX-d.x)/d.s,y:d.ty+(e.clientY-d.y)/d.s}));}}
      onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
      <defs><clipPath id={clip}><rect width={W} height={H}/></clipPath></defs>
      <g clipPath={`url(#${clip})`}><g transform={`translate(${W/2+transform.x} ${H/2+transform.y}) scale(${transform.k}) translate(${-W/2} ${-H/2})`}>
        {items.map((item,i)=><g key={i} className="plan-ink" data-ink={step>=0&&item.step>step?'future':step>=0&&item.step===step?'active':'shown'}><Item item={item}/></g>)}
      </g></g>
    </svg>
    {lab?.kind==='wind'&&step===2&&<AeroField2D key="wind-force" lab={lab} transform={transform} step={step} force/>}
    {lab?.kind==='engine'&&<AeroField2D key="engine" lab={lab} transform={transform} step={step}/>}
    {showLabels&&<Callouts labels={scene.labels} nodes={nodes} selected={selected} spotlight={spotlight} onSelect={onSelect}/>}
    <GuideLayer motion={guide}/>
  </div>;
}
