import * as T from 'three';
import { BODY, DOMAIN, POD, WING, TAIL, bodyRadius, worldAt } from './airframe.js';
import { GRID } from './solver.js';
import { colorize, FlowParticles, makeTraces, WORLD_RANGE } from './visual-flow.js';
const TAU=Math.PI*2;

function skin(profile,a=0,b=TAU,segments=52){
  const verts=[],idx=[];
  for(const [x,r] of profile)for(let j=0;j<=segments;j++){const t=a+(b-a)*j/segments;verts.push(x,Math.cos(t)*r,Math.sin(t)*r);}
  for(let i=0;i<profile.length-1;i++)for(let j=0;j<segments;j++){
    const u=i*(segments+1)+j, v=u+segments+1;idx.push(u,u+1,v,v,u+1,v+1);
  }
  const geo=new T.BufferGeometry();geo.setAttribute('position',new T.Float32BufferAttribute(verts,3));geo.setIndex(idx);geo.computeVertexNormals();return geo;
}
function double(mid){const m=mid.clone();m.side=T.DoubleSide;return m;}
function wing(points,sign,root,k,fill,thick,tilt,origin=0){
  const outline=new T.Shape();points.forEach(([x,z],i)=>i?outline.lineTo(x,-z*sign):outline.moveTo(x,-z*sign));outline.closePath();
  const g=new T.ExtrudeGeometry(outline,{depth:thick,bevelEnabled:true,bevelSegments:2,bevelThickness:.019,bevelSize:.028,steps:1,curveSegments:1});g.rotateX(-Math.PI/2);
  const p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setY(i,p.getY(i)+Math.abs(p.getZ(i))*tilt-.042+origin);g.computeVertexNormals();
  k.mesh(g,[k.mat(fill,.23,.55),k.mat('#899f99',.29,.56)],[0,0,0],root);
  const y=(z)=>Math.abs(z)*tilt+thick-.011+origin;
  const [a,,c,d]=points;
  const outer=points.length>5?d:c,last=points.at(-1),corner=points.at(-2);
  k.strokes([[[a[0],y(a[1]),a[1]*sign],...points.slice(1,4).map(([x,z])=>[x,y(z),z*sign])],[[last[0]-.23,y(last[1]),last[1]*sign],[corner[0]-.16,y(corner[1]),corner[1]*sign]]],'#567b73',{parent:root,opacity:.84});
  if(points.length>5){
    const tip=wingTip(outer,sign,tilt,origin);k.mesh(tip,double(k.mat('#408477',.09,.54)),[0,0,0],root);
    const h=sign>0?'#71aa98':'#b7826b';k.box([outer[0]-.025,y(outer[1])+.035,outer[1]*sign],[.10,.095,.08],h,{radius:.023,parent:root});
  }
}
function wingTip([x,z],sgn,tilt,offset){
  const y=z*tilt+offset;
  const v=[x-.13,y,z*sgn,x+.34,y,z*sgn,x+.37,y+.25,(z+.03)*sgn,x+.14,y+.23,(z+.02)*sgn];
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(v,3));g.setIndex([0,1,2,2,3,0]);g.computeVertexNormals();return g;
}
function civilAirliner(root,k){
  const {mat,mesh,box,cylinder,ring,strokes,inst}=k;
  mesh(skin(BODY),double(mat('#d5ddd8',.31,.48)),[0,.13,0],root);
  const stripes=BODY.slice(2,-1).map(([x,r])=>[x,r+.008]);
  for(let side of [-1,1]){
    const flip=side<0?TAU:0;
    mesh(skin(stripes,flip+side*1.75,flip+side*1.92,6),double(mat('#427c76',.16,.51)),[0,.13,0],root,false);
    const windows=[];
    for(let i=0;i<25;i++){
      const x=-3.13+i*.234,r=bodyRadius(x);
      if(r<.53)continue;
      windows.push([[x,.296,side*Math.sqrt(r*r-.166*.166)],[.116,.126,.025]]);
    }
    inst(windows,'#375852',{m:.34,rough:.38,parent:root});
    const glass=[[-4.47,bodyRadius(-4.47)+.011],[-4.26,bodyRadius(-4.26)+.010],[-4.02,bodyRadius(-4.02)+.014],[-3.88,bodyRadius(-3.88)+.010]];
    mesh(skin(glass,flip+side*.435,flip+side*1.15,9),double(mat('#344e52',.45,.32)),[0,.13,0],root,false);
    const noseX=-4.08, r=bodyRadius(noseX)+.019;
    strokes([[[noseX,.13+r*.85,side*r*.53],[noseX,.13+r*.49,side*r*.89]]],'#b7c5bd',{parent:root,opacity:.95});
    for(const x of [-3.53,2.02]){
      const r=bodyRadius(x),z=side*r*.966;
      strokes([[[x-.08,.08,z],[x-.084,.52,z*.89],[x+.087,.52,z*.89],[x+.092,.08,z],[x-.08,.08,z]]],'#6f8d82',{parent:root,opacity:.61});
    }
    wing(WING,side,root,k,'#afc2bd',.105,.048,-.16);
    wing(TAIL,side,root,k,'#a6bfb3',.074,.07,.19);
    const pz=POD.z*side, y=-.42;
    box([POD.x+.11,-.225,pz],[.83,.23,.21],'#8da8a0',{radius:.05,m:.28,parent:root});
    const p= [[POD.x-.74,.27],[POD.x-.66,.346],[POD.x-.47,.364],[POD.x+.25,.322],[POD.x+.65,.246],[POD.x+.74,.192]];
    mesh(skin(p),double(mat('#b5c6c0',.58,.39)),[0,y,pz],root);
    const cap=cylinder([POD.x-.685,y,pz],.515,.034,'#2f4c49',{m:.24,parent:root,seg:28});cap.rotation.z=-Math.PI/2;
    const lip=ring([POD.x-.69,y,pz],.285,.058,'#d4e1d7',{m:.62,parent:root,flat:false});lip.rotation.y=Math.PI/2;
    const cone=cylinder([POD.x-.704,y,pz],.12,.107,'#9eb3ad',{m:.41,parent:root,seg:18,bottom:.09});cone.rotation.z=-Math.PI/2;
    const exhaust=cylinder([POD.x+.775,y,pz],.305,.11,'#526960',{m:.59,parent:root,seg:25});exhaust.rotation.z=-Math.PI/2;
  }
  // Vertical fin; unsupported areas are a schematic aircraft, not a real type.
  const tail=new T.Shape();[[2.26,.32],[2.67,.75],[3.28,1.82],[3.68,1.86],[3.94,1.49],[4.12,.27]].forEach(([x,y],i)=>i?tail.lineTo(x,y):tail.moveTo(x,y));tail.closePath();
  const fin=new T.ExtrudeGeometry(tail,{depth:.149,bevelEnabled:true,bevelSize:.028,bevelThickness:.023,bevelSegments:2,steps:1});
  mesh(fin,mat('#448278',.26,.50),[0,0,-.074],root);
  for(const z of [-.106,.106])strokes([[[2.89,.77,z],[3.18,1.1,z],[3.76,1.07,z]],[[3.05,.56,z],[3.31,.86,z],[3.85,.85,z]]],'#b7d0c0',{parent:root,opacity:.83});
}

function flowingPlane(root,context){
  const lab=context?.lab;
  const data=new Uint8Array(GRID.nx*GRID.ny*4), tex=new T.DataTexture(data,GRID.nx,GRID.ny,T.RGBAFormat);
  tex.magFilter=T.LinearFilter;tex.minFilter=T.LinearFilter;tex.colorSpace=T.SRGBColorSpace;
  const [w,h]=WORLD_RANGE, pg=new T.PlaneGeometry(w,h);pg.rotateX(Math.PI/2);
  const surface=new T.Mesh(pg,new T.MeshBasicMaterial({map:tex,side:T.DoubleSide,transparent:true,opacity:.85,depthWrite:false,toneMapped:false}));
  surface.position.set((DOMAIN.minX+DOMAIN.maxX)/2,-.74,0);surface.renderOrder=0;root.add(surface);
  const cap=15000, a=new Float32Array(cap*3);
  const g=new T.BufferGeometry(), attr=new T.BufferAttribute(a,3);attr.setUsage(T.DynamicDrawUsage);g.setAttribute('position',attr);g.setDrawRange(0,0);
  const material=new T.LineBasicMaterial({color:'#408c82',transparent:true,opacity:.40,depthWrite:false,toneMapped:false});
  const lines=new T.LineSegments(g,material);lines.frustumCulled=false;lines.renderOrder=1;root.add(lines);
  const p=new Float32Array(32*8*3), c=new Float32Array(p.length);
  const pglyph=new T.BufferGeometry(), pAttr=new T.BufferAttribute(p,3), cAttr=new T.BufferAttribute(c,3);
  pAttr.setUsage(T.DynamicDrawUsage);cAttr.setUsage(T.DynamicDrawUsage);pglyph.setAttribute('position',pAttr);pglyph.setAttribute('color',cAttr);pglyph.setDrawRange(0,0);
  const glints=new T.Points(pglyph,new T.PointsMaterial({size:.049,vertexColors:true,transparent:true,opacity:.86,depthWrite:false,toneMapped:false}));glints.frustumCulled=false;glints.renderOrder=2;root.add(glints);
  const dark=new T.Color('#347d72'),light=new T.Color('#87b8a9'),cold=new T.Color('#407a9b'),col=new T.Color();
  const tracers=new FlowParticles(179);
  let last=null,hue='',paths=[];
  const noMotion=typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (dt,step)=>{
    const f=lab?.field?.current, cfg=lab?.settings?.current?.wind;
    if(!f?.data)return false;
    const layer=cfg?.layer||'speed',fresh=last!==f||hue!==layer;
    if(fresh){
      last=f;hue=layer;surface.visible=layer!=='lines';
      if(surface.visible){colorize(f,layer,data,.59,true);tex.needsUpdate=true;}
      paths=makeTraces(f,29,10);let i=0;
      for(const path of paths){const pts=path.points,y=path.upstream?.047:.11;
        for(let j=0;j+1<pts.length&&i+2<cap;j++){
          if(!path.upstream&&j%5===0)continue;
          const p=pts[j],q=pts[j+1];a[i*3]=p[2];a[i*3+1]=y;a[i*3+2]=p[3];i++;a[i*3]=q[2];a[i*3+1]=y;a[i*3+2]=q[3];i++;
        }
      }attr.needsUpdate=true;g.setDrawRange(0,i);
    }
    const focused=step===2?.55:layer==='lines'?.61:.41;
    const changed=material.opacity!==focused;material.opacity=focused;
    if(!fresh&&!changed&&(cfg?.paused||noMotion))return false;
    const positions=tracers.move(f,(!cfg?.paused&&!noMotion)?dt:0);
    let j=0;
    for(let i=0;i<positions.length;i+=3){
      const [x,z]=worldAt(positions[i],positions[i+1],f.nx,f.ny), wake=i%15===0;
      p[i]=x;p[i+1]=wake?.13:.062;p[i+2]=z;
      col.copy(hue==='wake'&&wake?cold:dark).lerp(light,i%6?.42:.095);c[i]=col.r;c[i+1]=col.g;c[i+2]=col.b;j++;
    }
    pAttr.needsUpdate=true;cAttr.needsUpdate=true;pglyph.setDrawRange(0,j);return true;
  };
}

export function installCivilJet(root,k,animations,state,context){
  civilAirliner(root,k);
  // Fit includes the flow sheet so it doesn't jump as traces evolve.
  state.frame=new T.Box3(new T.Vector3(DOMAIN.minX,-.78,-4.8),new T.Vector3(DOMAIN.maxX,1.9,4.8));
  animations.push(flowingPlane(root,context));
  const arrow=new T.Group();arrow.position.set(1.38,.63,1.08);arrow.visible=false;root.add(arrow);
  const ink=new T.MeshBasicMaterial({color:'#ae6048',toneMapped:false});
  const stem=k.mesh(new T.CylinderGeometry(.041,.041,1,12),ink,[0,0,0],arrow,false);stem.rotation.z=-Math.PI/2;
  const head=k.mesh(new T.ConeGeometry(.118,.29,18),ink,[0,0,0],arrow,false);head.rotation.z=-Math.PI/2;
  let old=-1;
  animations.push((_,step)=>{
    const f=context?.lab?.field.current, show=step===2&&!!f, drag=f?.drag??0;
    const changed=arrow.visible!==show||(show&&Math.abs(old-drag)>.014);
    arrow.visible=show;
    if(show&&changed){old=drag;const length=.47+Math.min(2.5,.90*drag);stem.scale.y=length;stem.position.x=length/2;head.position.x=length+.13;}
    return changed;
  });
}

function rim(outer,inner,x,a,b){
  const g=new T.RingGeometry(inner,outer,56,1,a,b-a);
  // UV angle is mapped to a Y/Z cross-section; the axis runs along X.
  const p=g.getAttribute('position');for(let i=0;i<p.count;i++)p.setXYZ(i,x,p.getX(i),p.getY(i));g.computeVertexNormals();return g;
}
function shell(root,k,outer,inner,a,b,skinColor,edge,rough=.43){
  const {mesh,mat,strokes}=k,m=double(mat(skinColor,.53,rough)),e=double(mat(edge,.39,.48));
  mesh(skin(outer,a,b,51),m,[0,0,0],root);
  mesh(skin(inner,a,b,51),double(mat('#658078',.41,.53)),[0,0,0],root);
  for(const j of [0,outer.length-1])mesh(rim(outer[j][1],inner[j][1],outer[j][0],a,b),e,[0,0,0],root);
  const pts=[];
  for(const theta of [a,b]){
    const seam=outer.map(([x,r])=>[x,Math.cos(theta)*r,Math.sin(theta)*r]);
    const liner=inner.map(([x,r])=>[x,Math.cos(theta)*r,Math.sin(theta)*r]);
    pts.push(seam);const p=[],index=[];
    for(let i=0;i<seam.length;i++){
      p.push(...seam[i],...liner[i]);const j=i*2;
      if(i<seam.length-1)index.push(j,j+1,j+2,j+2,j+1,j+3);
    }
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setIndex(index);g.computeVertexNormals();mesh(g,e,[0,0,0],root);
  }
  strokes(pts,edge,{parent:root,opacity:.94});
}
function drum(root,k,{x,r,hub=.30,n=16,color='#83a69c',pitch=1,cap=true}){
  const g=new T.Group();g.position.x=x;root.add(g);
  const b=new T.Shape();const q=r*.28*pitch;
  [[-.10*r,hub],[.11*r,hub],[q*.95,r*.69],[q,r*.98],[q-.114*r,r],[q-.19*r,r*.86],[-.13*r,hub*.98]].forEach(([u,v],i)=>i?b.lineTo(u,v):b.moveTo(u,v));b.closePath();
  const blade=new T.ExtrudeGeometry(b,{depth:.040+r*.052,bevelEnabled:true,bevelSize:.007,bevelThickness:.007,bevelSegments:1,steps:1,curveSegments:1});blade.rotateY(Math.PI/2);
  const m=k.mat(color,.58,.39), blades=new T.InstancedMesh(blade,m,n), o=new T.Object3D();
  for(let i=0;i<n;i++){o.rotation.x=i*TAU/n;o.updateMatrix();blades.setMatrixAt(i,o.matrix);}blades.instanceMatrix.needsUpdate=true;blades.castShadow=true;blades.receiveShadow=true;g.add(blades);
  const disk=k.cylinder([.035,0,0],hub*2.44,.097,color,{m:.54,parent:g,seg:32});disk.rotation.z=Math.PI/2;
  if(cap){const cone=k.cylinder([-.146,0,0],hub*.87,.32,'#b3c5bd',{m:.59,bottom:hub*2.17,parent:g,seg:32});cone.rotation.z=Math.PI/2;}
  return g;
}
function engineFlow(root,k){
  const paths=new T.Group();root.add(paths);
  const lines=[], rx=-4.6;
  for(const [idx,[y,z]] of [[-.86,.86],[-1.04,.26],[-.33,-1.25],[.79,-.94]].entries()){
    const p=[[rx,y*.81,z*.8],[-3.45,y,z],[-1.6,y*.96,z*.96],[.7,y*.81,z*.81],[2.8,y*.59,z*.59],[4.51,y*.39,z*.39]];
    const c='#5b9c90';k.strokes([p],c,{parent:paths,opacity:.76});
    k.arrow([3.19,y*.53,z*.53],[4.51,y*.39,z*.39],c,.055,paths);
    lines.push({curve:new T.CatmullRomCurve3(p.map(v=>new T.Vector3(...v))),core:false,offset:idx*.237});
  }
  for(const [i,[y,z]] of [[.35,.26],[.42,-.17],[-.26,.36]].entries()){
    const p=[[-3.1,y*1.2,z*1.1],[-2.5,y*.89,z],[-.65,y*.58,z*.7],[.39,y*1.18,z*1.45],[1.7,y*.69,z*.90],[3.14,y*.59,z],[4.76,y*.47,z*.77]];
    const c='#ca8a66';k.strokes([p],c,{parent:paths,opacity:.72});k.arrow([3.15,y*.59,z],[4.76,y*.47,z*.77],c,.067,paths);
    lines.push({curve:new T.CatmullRomCurve3(p.map(v=>new T.Vector3(...v))),core:true,offset:i*.315});
  }
  const geometry=new T.BufferGeometry(),pts=new T.BufferAttribute(new Float32Array(lines.length*7*3),3), colors=new T.BufferAttribute(new Float32Array(lines.length*7*3),3);
  pts.setUsage(T.DynamicDrawUsage);
  const hot=new T.Color('#d49d74'),cool=new T.Color('#489f94');
  lines.forEach((l,idx)=>{const c=l.core?hot:cool;for(let j=0;j<7;j++)colors.setXYZ(idx*7+j,c.r,c.g,c.b);});
  geometry.setAttribute('position',pts);geometry.setAttribute('color',colors);
  const moving=new T.Points(geometry,new T.PointsMaterial({size:.088,transparent:true,opacity:.93,vertexColors:true,depthWrite:false,toneMapped:false}));moving.frustumCulled=false;paths.add(moving);
  let time=.07;const tmp=new T.Vector3();
  return {paths,tick(dt,rpm){time=(time+Math.max(0,dt)*rpm)%50;lines.forEach((l,i)=>{for(let j=0;j<7;j++){l.curve.getPoint((time*(l.core?.32:.22)+l.offset+(j/7))%1,tmp);pts.setXYZ(i*7+j,tmp.x,tmp.y,tmp.z);}});pts.needsUpdate=true;}};
}

export function installTurbofan(root,k,animations,state,context){
  const {mat,mesh,box,ring,cylinder,strokes}=k;
  const outer=[[-4.20,1.52],[-4.04,1.68],[-3.61,1.72],[-2.58,1.65],[-.98,1.48],[.70,1.30],[2.29,1.07],[3.25,.87],[4.24,.66]];
  const inr=outer.map(([x,r],i)=>[x,r-(i<4?.165:.12)]);
  const a=Math.PI*.86,b=a+Math.PI;
  // A diametral plane strips the viewer-facing half of the case from nose to tail.
  shell(root,k,outer,inr,a,b,'#83a29a','#b99478',.47);
  const front=new T.Group();root.add(front);shell(front,k,outer,inr,b,a+TAU,'#9cafaa','#c5cdbf',.41);
  for(const [x,r] of [[-3.97,1.68],[-2.59,1.65],[-.98,1.48],[.71,1.30],[2.31,1.07],[3.29,.87]]){
    const f=[[x-.035,r+.019],[x+.05,r+.019]];
    mesh(skin(f,a,b,47),double(mat('#bac9c1',.72,.40)),[0,0,0],root,false);
    mesh(skin(f,b,a+TAU,36),double(mat('#d0d8cb',.68,.29)),[0,0,0],front,false);
  }
  const rearLip=[[3.89,.59],[4.10,.59],[4.19,.58],[4.34,.57]];
  shell(root,k,rearLip,rearLip.map(([x,r])=>[x,r-.095]),a,b,'#7f9b92','#aeac90');
  const body=cylinder([.11,0,0],.325,7.26,'#6c8278',{m:.69,rough:.38,parent:root,seg:38});body.rotation.z=Math.PI/2;
  const foreCore=[[-3.14,.93],[-2.56,.87],[-1.82,.79],[-.96,.68],[-.34,.61]];
  shell(root,k,foreCore,foreCore.map(([x,r])=>[x,r-.075]),2.38,5.74,'#7e998d','#a6bfad');
  const aftCore=[[.86,.68],[1.39,.70],[2.00,.75],[2.67,.72],[3.22,.61]];
  shell(root,k,aftCore,aftCore.map(([x,r])=>[x,r-.07]),2.40,5.51,'#9b9984','#bc9a75');
  const chamber=[[-.47,.58],[-.16,.72],[.29,.85],[.59,.825],[.95,.70],[1.10,.61]];
  shell(root,k,chamber,chamber.map(([x,r])=>[x,r-.13]),1.48,5.96,'#a56e54','#d2a37f',.57);
  const heater=[[ -.27,.46],[.15,.53],[.49,.57],[.81,.47]];
  mesh(skin(heater,1.62,5.96,31),double(mat('#d39f72',.22,.65)),[0,0,0],root,false);
  for(const [x,r] of [[-.41,.59],[.08,.78],[.55,.82],[.92,.71]])mesh(skin([[x-.045,r+.01],[x+.036,r+.01]],1.48,5.96,38),double(mat('#c49373',.54,.52)),[0,0,0],root,false);
  const fan=drum(root,k,{x:-3.74,r:1.46,hub:.31,n:19,color:'#7da59e'});
  const low=[],high=[];
  for(let i=0;i<7;i++)low.push(drum(root,k,{x:-2.93+i*.34,r:.861-i*.048,hub:.27,n:i<3?17:15,color:i%2?'#9cbdae':'#5f8c80',pitch:i%2?-0.55:.75,cap:false}));
  for(let i=0;i<4;i++)high.push(drum(root,k,{x:1.18+i*.41,r:.561+i*.045,hub:.253,n:15,color:i%2?'#ad9c7d':'#79968a',pitch:i%2?.91:-.59,cap:false}));
  // Mounts, section edges, and a small labeled pedestal provide scale without measurements.
  for(const x of [-2.23,2.16]){
    box([x,-1.48,.015],[.60,.47,.59],'#6a867a',{radius:.068,m:.39,parent:root});
    box([x,-1.69,.03],[.93,.14,1.02],'#a1b4a8',{radius:.051,m:.44,parent:root});
  }
  box([-.49,-1.84,.03],[7.28,.23,2.05],'#91a99e',{radius:.12,m:.36,parent:root});
  box([-.49,-1.69,.70],[4.32,.053,.67],'#baccc2',{radius:.05,m:.22,parent:root,shadow:false});
  k.imprint([-.49,-1.655,.705],4.03,.38,'CIVIL TURBOFAN  /  SECTION VIEW',{ink:'#46675d',parent:root});
  for(const x of [-3.4,2.59])strokes([[[x,-1.705,-.85],[x,-1.705,.88]]],'#627e72',{parent:root,opacity:.77});
  const flow=engineFlow(root,k), noMotion=typeof window!=='undefined'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let prev=null;
  animations.push((dt,step)=>{
    const cfg=context?.lab?.settings?.current?.engine;
    const paused=cfg?.paused||noMotion,section=cfg?.section??true,paths=cfg?.paths??true,label=!!section+'|'+!!paths+'|'+!!paused;
    const updated=label!==prev;prev=label;front.visible=!section;flow.paths.visible=paths&&section;
    const speed=.34+(cfg?.speed||57)*.022;
    if(!paused){fan.rotation.x-=dt*speed*1.48;for(let i=0;i<low.length;i++)if(i%2===0)low[i].rotation.x-=dt*speed*(2.3+i*.32);for(let i=0;i<high.length;i++)if(i%2===0)high[i].rotation.x+=dt*speed*2.4;}
    if(flow.paths.visible&&(!paused||updated))flow.tick(paused?0:dt,speed);
    return updated||!paused;
  });
}
