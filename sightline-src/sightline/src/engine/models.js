import * as T from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { installCivilJet, installTurbofan } from './aero/model-aero.js';

function kit(root) {
  const materials = new Map(), geometries = new Map();
  const mat = (c, metal=0, rough=.52, opacity=1) => {
    const key=`${c}|${metal}|${rough}|${opacity}`;
    if (!materials.has(key)) materials.set(key,new T.MeshStandardMaterial({color:c, metalness:metal, roughness:rough, transparent:opacity<1, opacity, depthWrite:opacity>=1}));
    return materials.get(key);
  };
  const geo = (key,create) => {
    if (!geometries.has(key)) geometries.set(key, create());
    return geometries.get(key);
  };
  const mesh = (g,m,p,parent=root,shadow=true) => {
    const obj=new T.Mesh(g,m); obj.position.set(...p); obj.castShadow=shadow; obj.receiveShadow=true; parent.add(obj); return obj;
  };
  const box = (p,s,c,{m=0,rough=.52, radius=0,parent=root,shadow=true,opacity=1}={}) => {
    const g=radius ? geo(`round|${s}|${radius}`,()=>new RoundedBoxGeometry(...s,2,radius)) : geo('box',()=>new T.BoxGeometry());
    const out=mesh(g,mat(c,m,rough,opacity),p,parent,shadow);
    if (!radius) out.scale.set(...s);
    return out;
  };
  const inst = (rows,c,{m=0,rough=.5,parent=root,shadow=false}={}) => {
    if (!rows.length) return;
    const out=new T.InstancedMesh(geo('box',()=>new T.BoxGeometry()),mat(c,m,rough),rows.length);
    const trans=new T.Object3D();
    rows.forEach(([p,s],i)=>{trans.position.set(...p); trans.scale.set(...s); trans.updateMatrix(); out.setMatrixAt(i,trans.matrix);});
    out.instanceMatrix.needsUpdate=true; out.castShadow=shadow; out.receiveShadow=true; parent.add(out);
  };
  const cylinder = (p,diameter,h,c,{m=0,rough=.52,parent=root,bottom=diameter,seg=24,shadow=true}={}) => mesh(geo(`cylinder|${diameter}|${bottom}|${h}|${seg}`,()=>new T.CylinderGeometry(diameter/2,bottom/2,h,seg)), mat(c,m,rough),p,parent,shadow);
  const ring = (p, radius, tube, c,{m=0,parent=root,flat=true,shadow=true}={}) => {
    const obj=mesh(geo(`ring|${radius}|${tube}`,()=>new T.TorusGeometry(radius,tube,12,60)),mat(c,m,.43),p,parent,shadow);
    if (flat) obj.rotation.x=-Math.PI/2;
    return obj;
  };
  const strokes = (paths,c,{opacity=1,parent=root}={}) => {
    const points=[];
    for(const path of paths) for(let i=1;i<path.length;i++) points.push(...path[i-1],...path[i]);
    const g=new T.BufferGeometry(); g.setAttribute('position',new T.Float32BufferAttribute(points,3));
    const out=new T.LineSegments(g,new T.LineBasicMaterial({color:c,transparent:opacity<1,opacity,depthWrite:opacity>=1})); parent.add(out); return out;
  };
  const imprint = (p,w,h,text,{ink='#d7e4dc',mono=true,parent=root,angle=0}={}) => {
    const canvas=document.createElement('canvas'); canvas.width=384; canvas.height=144;
    const ctx=canvas.getContext('2d'); ctx.textAlign='center'; ctx.textBaseline='middle';
    const lines=text.split('\n');
    lines.forEach((t,i)=>{ctx.fillStyle=ink;ctx.font=`${i===0?'700':'600'} ${i===0?(lines.length===1?81:60):42}px ${mono?'monospace':'sans-serif'}`;ctx.fillText(t,192,lines.length===1?73:47+i*57,362);});
    const texture=new T.CanvasTexture(canvas); texture.colorSpace=T.SRGBColorSpace; texture.anisotropy=4;
    const g=new T.PlaneGeometry(w,h), m=new T.MeshBasicMaterial({map:texture,transparent:true,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-2, toneMapped:false});
    const obj=mesh(g,m,p,parent,false); obj.receiveShadow=false; obj.rotation.set(-Math.PI/2,0,angle); return obj;
  };
  const arrow = (p,to,c,width=.075,parent=root,head=true) => {
    const from=new T.Vector3(...p), dest=new T.Vector3(...to), diff=dest.clone().sub(from), len=diff.length();
    if (len<.008) return;
    diff.normalize();
    const tip=head?Math.min(len*.42, Math.max(width*3.4, .22)):0;
    const cyl=cylinder(from.clone().addScaledVector(diff,(len-tip)/2).toArray(),width,len-tip,c,{parent,seg:10,shadow:false});
    const dir=new T.Vector3(0,1,0); cyl.quaternion.setFromUnitVectors(dir,diff);
    if (tip) {
      const cone=cylinder(dest.clone().addScaledVector(diff,-tip*.5).toArray(),0,tip,c,{parent,bottom:Math.min(tip*.8,width*2.65),seg:14,shadow:false});
      cone.quaternion.copy(cyl.quaternion);
    }
  };
  return {mat,geo,mesh,box,inst,cylinder,ring,strokes,imprint,arrow};
}

const corners=[[-4.51,-3.28],[4.48,-3.28],[4.85,-2.91],[4.85,2.91],[4.48,3.28],[-4.51,3.28],[-4.88,2.91],[-4.88,-2.91]];
const holes=[[-4.34,-2.72],[-4.34,2.72],[4.31,-2.72],[4.31,2.72]];
function outline(points) {
  const shape=new T.Shape(); points.forEach(([x,z],i)=> i?shape.lineTo(x,-z):shape.moveTo(x,-z)); shape.closePath(); return shape;
}

function pcb(root,k,variant,animations,state) {
  const {box,mesh,mat,ring,cylinder,inst,strokes,imprint,arrow}=k;
  const shape=outline(corners);
  for(const [x,z] of holes){const h=new T.Path(); h.absarc(x,-z,.215,0,Math.PI*2,true); shape.holes.push(h);}
  const slab=new T.ExtrudeGeometry(shape,{depth:.25,steps:1,bevelEnabled:true,bevelThickness:.041,bevelSize:.046,bevelSegments:3,curveSegments:20});
  slab.rotateX(-Math.PI/2);
  mesh(slab,[mat('#226644',.04,.60),mat('#194e35',.05,.59)],[0,-.292,0]);
  const skin=new T.ShapeGeometry(shape,20); skin.rotateX(-Math.PI/2);
  mesh(skin,mat('#246848',.09,.65),[0,.004,0],root,false);
  const perimeter=[...corners,corners[0]];
  strokes([perimeter.map(([x,z])=>[x*.997,.009,z*.996]),perimeter.map(([x,z])=>[x*1.006,-.13,z*1.009])],'#78a779',{opacity:.7});
  strokes([perimeter.map(([x,z])=>[x*1.006,-.20,z*1.009])],'#3c6851',{opacity:.65});
  for(const [x,z] of holes) {
    const g=new T.RingGeometry(.211,.365,38);g.rotateX(-Math.PI/2);
    mesh(g,mat('#ccab58',.61,.35),[x,.017,z],root,false);
    ring([x,.015,z],.293,.018,'#d2b773',{m:.46,shadow:false});
    const h=new T.CylinderGeometry(.208,.208,.24,28,1,true);
    const m=mat('#9f8146',.45,.54).clone();m.side=T.BackSide; mesh(h,m,[x,-.123,z],root,false);
    ring([x,.022,z],.217,.012,'#907842',{m:.33,shadow:false});
  }
  const traceA=[], traceB=[], pads=[], vias=[], tiny=[], gold=[], smallSolder=[];
  for(let i=0;i<13;i++) {
    const x=-2.54+i*.169, xx=x+.32; const startZ=-1.07, endZ=-2.80-(i%3)*.075;
    const arr=[[x,.016,startZ],[x,.016,-1.54],[xx,.016,-1.86],[xx,.016,endZ]];
    (i%4?traceA:traceB).push(arr); pads.push([[x,.018,-1.42],[.049,.025,.08]]);
    if(i%2)vias.push([[xx,.022,-2.47],[.057,.034,.057]]);
  }
  for(let i=0;i<9;i++){
    const x=-2.5+i*.239; const z=1.52+(i%2)*.09;
    traceA.push([[x,.014,.96],[x,.014,z],[x-.23,.014,z+.25],[x-.23,.014,2.31+(i%3)*.27]]);
    if(i%3!==0) vias.push([[x-.23,.019,2.17+(i%3)*.23],[.065,.043,.065]]);
  }
  for(let i=0;i<12;i++) {
    const z=-1.46+i*.26;
    const off=(i%4)*.128;
    (i%3===0?traceB:traceA).push([[.74,.013,z+.2],[1.79+off,.013,z+.2],[2.04+off,.013,z-.06],[3.36,.013,z-.06],[3.59,.013,z-.29]]);
    if(i%3===1)pads.push([[2.65+off,.019,z-.06],[.12,.031,.055]]);
  }
  for(let i=0;i<8;i++) {
    const z=-1.5+i*.42;
    traceB.push([[-2.60,.016,z],[-3.16,.016,z],[-3.45,.016,z+.29],[-4.21,.016,z+.29]]);
    vias.push([[-3.91,.018,z+.29],[.054,.026,.058]]);
  }
  strokes(traceA,'#87b68c',{opacity:.60}); strokes(traceB,'#b6bd77',{opacity:.58});
  const white=[];
  for(const [x,z,w,d] of [[-1.37,0,2.39,2.18],[.82,.31,1.70,1.29],[-3.60,.88,.87,.74],[1.29,1.94,.85,.64],[-.79,2.59,1.94,.45],[-.59,-2.77,5.86,.62],[2.09,-1.57,.78,.83],[-4.22,1.75,.61,.43]]) {
    const a=w/2,b=d/2;
    white.push([[x-a,.017,z-b],[x+a,.017,z-b],[x+a,.017,z+b],[x-a,.017,z+b],[x-a,.017,z-b]]);
  }
  strokes(white,'#c4d1ad',{opacity:.76});
  let seed=1632;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(const [x,z,nx,nz,dx,dz] of [[-4.02,-1.99,5,5,.23,.23],[-3.96,-.34,5,3,.25,.22],[.14,-2.23,9,3,.24,.22],[.15,1.27,10,4,.25,.26],[-2.72,1.23,7,3,.23,.2],[-3.79,2.0,5,2,.24,.26],[2.43,-2.48,3,7,.22,.38]]) {
    for (let i=0;i<nx;i++) for(let j=0;j<nz;j++){
      if(random()>.76)continue;
      const X=x+i*dx,Z=z+j*dz;const width=.062+random()*.065, length=.078+random()*.064;
      (random()>.65?gold:tiny).push([[X,.067,Z],[width,.107,length]]);
      smallSolder.push([[X-width*.62,.037,Z],[.035,.045,length*.89]],[[X+width*.62,.037,Z],[.035,.045,length*.89]]);
      if(random()>.7) vias.push([[X+.095,.021,Z+.102],[.051,.036,.051]]);
    }
  }
  inst(vias,'#c2a966',{m:.35,rough:.52}); inst(pads,'#bca760',{m:.39}); inst(tiny,'#354039',{rough:.65});inst(gold,'#9a7e50',{m:.29});inst(smallSolder,'#b7bdb3',{m:.58});
  // Header, SoC, RAM, power chips.
  box([-.62,.111,-2.76],[5.85,.207,.64],'#243331',{radius:.055});
  const pins=[], collars=[];
  for(let i=0;i<20;i++) for(let j=0;j<2;j++) {
    const x=-3.30+i*.281,z=-2.91+j*.286;
    pins.push([[x,.365,z],[.073,.46,.076]]);
    collars.push([[x,.223,z],[.127,.055,.125]]);
  }
  inst(collars,'#415049',{rough:.44}); inst(pins,'#d6b46e',{m:.69,rough:.34,shadow:true});
  box([-1.37,.119,0],[2.27,.23,2.03],'#223e35',{radius:.076});
  box([-1.37,.265,0],[1.98,.20,1.76],'#687875',{radius:.058,m:.58,rough:.46});
  box([-1.37,.385,0],[1.80,.095,1.64],'#cad3ce',{radius:.041,m:.57,rough:.46});
  imprint([-1.37,.436,.055],1.60,.70,'BCM2712\nARM CORTEX-A76',{ink:'#52645d'});
  const ledges=[];
  for(let i=0;i<13;i++) {
    ledges.push([[-2.43+i*.177,.07,-1.04],[.07,.09,.15]],[[-2.43+i*.177,.07,1.04],[.07,.09,.15]]);
  }
  inst(ledges,'#bfb281',{m:.49});
  box([.856,.145,.288],[1.55,.27,1.16],'#283634',{radius:.061});
  box([.856,.276,.288],[1.46,.047,1.07],'#343f3b',{radius:.020});
  imprint([.85,.304,.30],1.26,.53,'LPDDR4X',{ink:'#b8c2b4'});
  for(const [x,z,w,d] of [[-3.6,.87,.80,.69],[-3.72,-.99,.54,.51],[1.32,1.87,.74,.57],[2.06,-1.58,.68,.72],[2.63,1.18,.53,.57],[-3.13,-1.75,.49,.40],[-2.6,.94,.39,.43]]) {
    box([x,.105,z],[w,.195,d],'#2c3932',{radius:.035});
    const legs=[];for(let i=0;i<5;i++){const X=x-w*.37+i*w*.185;legs.push([[X,.060,z-d*.55],[.04,.075,.101]],[[X,.060,z+d*.55],[.04,.075,.101]]);}inst(legs,'#aab4a8',{m:.51});
  }
  imprint([-3.41,.017,-.04],1.61,.51,'Raspberry Pi 5',{ink:'#c5ddbf',mono:false});
  imprint([.9,.018,2.48],1.13,.4,'REV 1.0',{ink:'#c5d7b8'});
  imprint([-.82,.017,2.15],1.10,.29,'CAM / DISP',{ink:'#d0dfba'});
  // Small passives and edge-facing HDMI / power ports.
  for(const [x,z,w,d] of [[-3.01,3.09,.81,.69],[.59,3.095,.73,.68],[1.55,3.095,.73,.68]]) {
    box([x,.225,z],[w,.415,d],'#abb8b2',{m:.76,rough:.39,radius:.068});
    box([x,.216,z+d*.515],[w*.75,.235,.057],'#2f3d3a',{radius:.035,m:.15});
    box([x,.214,z+d*.552],[w*.61,.065,.028],'#c1a785',{radius:.010,m:.30});
    box([x,.441,z],[w*.61,.014,d*.56],'#c3ccc5',{m:.7,rough:.51,radius:.004,shadow:false});
  }
  box([-.78,.109,2.57],[1.91,.196,.405],'#d8ca9c',{radius:.035});
  box([-.78,.223,2.604],[1.63,.108,.214],'#424238',{radius:.028});
  box([-.78,.281,2.533],[1.56,.016,.034],'#ae9c67',{radius:.006,shadow:false});
  inst(Array.from({length:22},(_,i)=>[[-1.51+i*.070,.072,2.825],[.033,.083,.135]]),'#b8ae86',{m:.64});
  box([-3.82,.66,-1.87],[.56,.56,.48],'#e5dcc0',{radius:.047});
  box([-3.82,.72,-1.62],[.36,.25,.026],'#858876',{radius:.025});
  for(const [x,z] of [[2.62,-1.93],[2.63,-1.31],[2.60,-.75],[-3.17,1.61],[-2.82,1.87]]) {
    cylinder([x,.19,z],.29,.38,'#596e64',{m:.22,seg:20});cylinder([x,.39,z],.27,.047,'#aebbb1',{m:.65,seg:20,shadow:false});
  }
  for(const [j,z] of [[0,-1.81],[1,-.15]]) {
    const x=4.06, shade=j?'#9baaa6':'#afbebd';
    box([x,.64,z],[1.97,1.27,1.47],shade,{m:.75,rough:.42,radius:.075});
    box([x,.648,z],[1.48,1.295,1.38],'#c1ceca',{m:.64,rough:.37,radius:.038});
    const face=5.063;
    box([face,.64,z],[.068,1.095,1.315],'#526562',{m:.57,rough:.45,radius:.030});
    for(const yy of [.398,.881]) {
      box([face+.041,yy,z],[.054,.379,1.112],'#202d2e',{radius:.024});
      box([face+.073,yy-.067,z],[.026,.137,1.017],j?'#384948':'#2c6da1',{radius:.018,m:.11});
      for(let i=0;i<4;i++) box([face+.088,yy-.051,z-.35+i*.233],[.010,.028,.052],'#bcaa6e',{m:.63,radius:.005,shadow:false});
    }
    box([face+.046,.64,z],[.048,.085,1.225],'#b3c2bc',{m:.74,radius:.009});
    for(const zz of [-.35,.35]) {
      box([4.00,1.306,z+zz],[.84,.022,.115],'#8b9c98',{m:.7,radius:.007,shadow:false});
      box([4.08,1.322,z+zz],[.69,.02,.055],'#cbd5cf',{m:.69,radius:.006,shadow:false});
    }
  }
  box([3.96,.795,1.76],[2.21,1.58,1.91],'#a8b5b0',{m:.75,rough:.41,radius:.087});
  box([4.03,1.592,1.76],[1.64,.057,1.63],'#bfcbc6',{m:.72,rough:.39,radius:.025});
  box([5.09,.79,1.76],[.075,1.37,1.67],'#53625d',{m:.29,radius:.034});
  box([5.134,.805,1.76],[.031,1.055,1.20],'#25342f',{radius:.047});
  box([5.159,.72,1.76],[.025,.541,1.106],'#35443d',{radius:.024});
  box([5.157,.425,1.76],[.022,.19,.54],'#1e2d29',{radius:.019});
  for(let i=0;i<8;i++)box([5.171,1.17,1.36+i*.114],[.018,.151,.042],'#a48e50',{radius:.005,m:.5,shadow:false});
  box([5.138,.322,1.11],[.027,.108,.195],'#89ae74',{radius:.010});
  box([5.139,.322,2.413],[.027,.108,.195],'#cab06c',{radius:.010});
  for(let i=0;i<4;i++)box([4.20,1.624,1.235+i*.34],[.79,.018,.041],'#82948e',{m:.7,radius:.006,shadow:false});
  if(variant==='camera') {
    const ribbonSet=new T.Group(), latch=new T.Group(), guides=new T.Group();root.add(ribbonSet,latch,guides);
    box([-.78,.340,2.585],[1.64,.072,.135],'#435349',{radius:.024,parent:latch});
    box([-1.13,1.58,2.53],[1.15,2.67,.078],'#d0ad62',{radius:.037,m:.28,rough:.49,parent:ribbonSet});
    box([-1.13,.48,2.58],[1.07,.46,.040],'#356d99',{radius:.014,parent:ribbonSet});
    const ribbon=[];for(let i=0;i<17;i++)ribbon.push([[-1.63+i*.062,.71,2.577],[-1.63+i*.062,2.54,2.577]]);strokes(ribbon,'#e8c78a',{parent:ribbonSet});
    box([-1.13,2.94,2.53],[1.87,1.15,.165],'#398061',{radius:.09,parent:ribbonSet});
    box([-1.13,2.95,2.665],[.91,.78,.242],'#3b4942',{radius:.095,parent:ribbonSet});
    const lens=cylinder([-1.13,2.97,2.811],.54,.25,'#1d3438',{m:.43,rough:.23,parent:ribbonSet});lens.rotation.x=Math.PI/2;
    const glass=cylinder([-1.13,2.97,2.952],.345,.055,'#326278',{m:.67,rough:.16,parent:ribbonSet});glass.rotation.x=Math.PI/2;
    arrow([-.07,1.96,2.53],[-.07,.76,2.53],'#b9664c',.075,guides);
    state.labelOffset=(i,out)=>{if(i<2)out.y+=ribbonSet.position.y;else out.y+=latch.position.y*.6;};
    const noMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    animations.push((dt,step)=>{
      const goal=step===0?1.22:step===1?.52:0, up=step===0||step===1?.16:0;
      const shown=step===1||step<0, changed=guides.visible!==shown;
      guides.visible=shown;
      if(Math.abs(ribbonSet.position.y-goal)<.002&&Math.abs(latch.position.y-up)<.002)return changed;
      const ease=noMotion?1:1-Math.exp(-Math.max(dt,.007)*8.6);
      ribbonSet.position.y+=(goal-ribbonSet.position.y)*ease;latch.position.y+=(up-latch.position.y)*ease;
      return true;
    });
    state.movingShadows=true;
  }
}

function makeFan(root,k,animations) {
  const {box,ring,cylinder,mesh,mat,arrow}=k;
  const CY=1.0;
  box([0,-2.52,.13],[4.9,.29,2.74],'#385e54',{m:.23,radius:.14});
  box([0,-2.01,.04],[1.42,1.02,.93],'#4e7969',{m:.17,radius:.12});
  for(const [z,t] of [[-.44,.12],[.44,.14]]) ring([0,CY,z],2.41,t,'#467c69',{m:.45,flat:false});
  const g=new T.CylinderGeometry(2.468,2.468,.86,72,1,true);g.rotateX(Math.PI/2);
  const m=mat('#6e9d8a',.34,.49).clone();m.side=T.DoubleSide;mesh(g,m,[0,CY,0]);
  const motor=cylinder([0,CY,-.44],.98,1.17,'#364e49',{m:.38});motor.rotation.x=Math.PI/2;
  for(const a of [Math.PI/6,Math.PI*5/6,Math.PI*1.5]) {
    const support=box([Math.cos(a)*1.33,CY+Math.sin(a)*1.33,-.33],[2.15,.139,.133],'#547b70',{radius:.043,m:.22});support.rotation.z=a;
  }
  const rotor=new T.Group(); rotor.position.y=CY;root.add(rotor);
  const hub=cylinder([0,0,.2],1.13,.37,'#456f63',{m:.47,parent:rotor});hub.rotation.x=Math.PI/2;
  const cap=cylinder([0,0,.414],.69,.16,'#9baea2',{m:.61,rough:.29,parent:rotor});cap.rotation.x=Math.PI/2;
  const blade = new T.Shape();blade.moveTo(-.25,.38);blade.bezierCurveTo(-.28,1.01,-.30,1.88,.03,2.14);blade.bezierCurveTo(.28,2.36,.89,2.22,.71,1.67);blade.bezierCurveTo(.60,1.22,.27,.56,.19,.36);blade.closePath();
  const bg=new T.ExtrudeGeometry(blade,{depth:.115,bevelEnabled:true,bevelSize:.045,bevelThickness:.035,bevelSegments:3,steps:1,curveSegments:22});
  for(let i=0;i<4;i++){ const bladePivot=new T.Group();bladePivot.rotation.z=i*Math.PI/2;rotor.add(bladePivot);const obj=mesh(bg,mat('#9dc4a5',.34,.42),[0,0,.04],bladePivot);obj.rotation.y=-.29; }
  const noMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const inGuide=new T.Group(),outGuide=new T.Group();root.add(inGuide,outGuide);
  const particles=[],air='#518c91',outgoing='#449b9c';
  for(const [i,[x,y]] of [[-1.42,.1],[1.40,.1],[0,1.24],[0,-1.15]].entries()) {
    arrow([x,CY+y,-3.28],[x,CY+y,-.83],air,.075,inGuide);
    arrow([x,CY+y,.82],[x*1.15,CY+y*1.09,3.36],outgoing,.092,outGuide);
    if(!noMotion)for(const [dir,guide] of [[-1,inGuide],[1,outGuide]])for(let j=0;j<3;j++){
      const speck=mesh(new T.SphereGeometry(.055,8,6),mat(dir<0?'#a5c8bf':'#90c7c8',.12,.38),[x,CY+y,dir*1.47],guide,false);
      particles.push({speck,x,y,dir,phase:(j/3+i*.167)%1});
    }
  }
  let clock=0;
  animations.push((dt,step)=>{
    const incoming=step!==2,outgoing=step!==0,changed=inGuide.visible!==incoming||outGuide.visible!==outgoing;
    inGuide.visible=incoming;outGuide.visible=outgoing;
    if(noMotion)return changed;
    clock+=dt;rotor.rotation.z-=dt*(step===0?1.6:step===1?4.6:3.2);
    for(const p of particles){const t=(p.phase+clock*.63)%1;p.speck.position.set(p.x*(p.dir>0?1+t*.15:1),CY+p.y*(p.dir>0?1+t*.09:1),(p.dir>0?.95: -3.13)+2.30*t);}
    return true;
  });
}

function tokenStack(root,k,animations) {
  const {box,arrow,imprint}=k;
  const tokens=[['18'],['18','47'],['18','47','56']],rows=[];
  box([0,-.34,0],[10.05,.29,6.75],'#aabfb4',{radius:.13,m:.08,parent:root});
  for(let i=0;i<3;i++) {
    const z=(i-1)*2.09,parent=new T.Group();root.add(parent);rows.push(parent);
    for(const [j,n] of tokens[i].entries()) {
      const x=-3.53+j*1.43;
      box([x,.149,z],[1.20,.67,1.37],'#7aa4bb',{radius:.101,m:.15,parent});
      imprint([x,.49,z],1.06,.46,n,{ink:'#223f51',parent});
    }
    arrow([.29,.22,z],[2.52,.22,z],'#4e7468',.087,parent);
    box([3.59,.15,z],[1.49,.69,1.37],'#d29b80',{radius:.107,m:.15,parent});
    imprint([3.59,.51,z],1.19,.46,['47','56','57'][i],{ink:'#624234',parent});
  }
  animations.push((_,step)=>{let changed=false;rows.forEach((row,i)=>{const on=step<0||step>=i;if(row.visible!==on){row.visible=on;changed=true;}});return changed;});
}

function engineTile(el,root,k){
  const {box,inst,cylinder,ring,mat,mesh,strokes,imprint,arrow}=k;
  const g=new T.Group();g.position.set(...el.p);root.add(g);
  const [w,h,d]=el.s,c=el.color,form=el.form,sc=Math.min(w/1.93,d/1.70), top=h*.58;
  box([0,0,0],[w,h,d],'#62796e',{radius:.09,m:.33,parent:g});
  box([0,h*.47,0],[w*.968,h*.34,d*.956],c,{radius:.04,m:.22,parent:g});
  box([0,top+.029,d*.365],[w*.87,.051,d*.24],'#dce3d8',{radius:.022,m:.10,parent:g});
  box([0,top+.058,d*.365],[w*.80,.012,d*.174],'#bacbc0',{radius:.005,m:.17,parent:g,shadow:false});
  imprint([0,top+.066,d*.365],w*.72,d*.148,el.label||String(el.index??''),{ink:'#2b483e',parent:g});
  const fasteners=[];for(const x of [-w*.425,w*.425])for(const z of [-d*.37,d*.22])fasteners.push([[x,top+.036,z],[.088,.032,.084]]);
  inst(fasteners,'#c5baa0',{parent:g,m:.53});
  const core=new T.Group();core.position.set(0,top*.89,-d*.125);core.scale.setScalar(sc);g.add(core);
  const B=(p,s,col,opts={})=>box(p,s,col,{parent:core,...opts});
  const C=(p,diam,h,col,opts={})=>cylinder(p,diam,h,col,{parent:core,...opts});
  const R=(p,r,t,col,opts={})=>ring(p,r,t,col,{parent:core,...opts});
  const A=(p,to,col,width)=>arrow(p,to,col,width,core);
  const I=(data,col)=>inst(data,col,{parent:core,m:.51});
  if(form==='tube'){
    const tube=C([0,.39,0],.58,1.02,c,{m:.48,rough:.39});tube.rotation.z=Math.PI/2;
    for(const x of [-.51,.51]){const rim=R([x,.39,0],.262,.092,'#899e93',{m:.63,flat:false});rim.rotation.y=Math.PI/2;
      const dark=C([x,.39,0],.413,.018,'#253f39',{m:.11});dark.rotation.z=Math.PI/2;}
    for(const x of [-.31,.31])B([x,.12,0],[.17,.24,.38],'#465d54',{radius:.043});
  }else if(form==='chip'||form==='board'){
    B([0,.083,0],[form==='board'?1.43:1.07,.16,.95],form==='board'?'#41806b':'#364a42',{radius:.052});
    B([0,.221,0],[.65,.14,.55],c,{radius:.035,m:.34});B([0,.315,0],[.52,.065,.43],'#c3d1c8',{radius:.025,m:.56});
    const pins=[];for(let i=0;i<6;i++){const x=(i-2.5)*.14;pins.push([[x,.10,.49],[.069,.082,.18]],[[x,.10,-.49],[.069,.082,.18]]);}
    I(pins,'#d6ba76');if(form==='board'){B([.57,.178,0],[.20,.16,.53],'#b4bbac',{radius:.034,m:.56});B([-.56,.137,0],[.15,.075,.54],'#3d544d',{radius:.023});}
  }else if(form==='panel'||form==='screen'){
    B([0,.46,-.01],[1.18,.83,.16],'#425a53',{radius:.06,m:.4});
    B([0,.465,.086],[1.02,.67,.051],c,{radius:.032,m:.21,rough:form==='screen'?.22:.51});
    if(form==='panel'){
      const bars=[];for(let i=0;i<6;i++)bars.push([[0,.19+i*.102,.124],[.92,.027,.026]]);for(let i=0;i<8;i++)bars.push([[(-3.5+i)*.124,.465,.133],[.018,.62,.02]]);
      I(bars,'#b9c8bd');
    }else{
      B([-.15,.525,.118],[.68,.35,.017],'#c8ded3',{radius:.019,m:.22});B([.334,.527,.118],[.16,.35,.017],'#465f58',{radius:.019});B([0,.254,.118],[.98,.115,.017],'#6c9c89',{radius:.015});
    }
    B([0,.12,-.05],[.44,.12,.59],'#6c8175',{radius:.033,m:.30});
  }else if(form==='ring'){
    R([0,.438,0],.347,.11,c,{m:.47,flat:false});R([0,.44,.046],.36,.045,'#adc0b5',{m:.68,flat:false});B([0,.102,0],[.57,.2,.38],'#526a5e',{radius:.05,m:.22});
  }else if(form==='sphere'){
    mesh(new T.SphereGeometry(.418,32,22),mat(c,.36,.31),[0,.465,0],core);
    R([0,.47,0],.424,.012,'#cbdcca',{m:.22});const r=R([0,.468,0],.424,.015,'#cbdcca',{m:.22,flat:false});r.rotation.y=.83;
  }else if(form==='pin'){
    C([0,.108,0],.68,.17,'#849b90',{m:.41});C([0,.39,0],.27,.64,c,{m:.45});
    C([0,.69,0],.62,.18,'#c5c4aa',{m:.63,rough:.35});R([0,.786,0],.155,.032,'#637a6c',{m:.41});
  }else if(form==='flow'){
    const paths=[];
    for(let i=0;i<3;i++){const y=.28+i*.16,z=(i-1)*.23;A([-.66,y,z],[.64,y,z],i===1?'#47766b':c,.075);paths.push([[-.7,y,z],[-.79,y,z],[-.86,y-.03,z]]);}
    strokes(paths,'#80a097',{parent:core});
  }else{
    B([0,.18,0],[1.06,.32,.82],c,{radius:.060,m:.32});
    B([.14,.421,-.045],[.72,.20,.64],'#bdd0c2',{radius:.045,m:.44});
    B([.14,.564,-.045],[.51,.084,.48],c,{radius:.026,m:.28});
    I([[[-.38,.355,.29],[.11,.055,.13]],[[.38,.355,.29],[.11,.055,.13]]],'#c5b577');
  }
}

export function buildModel(scene,context) {
  const root=new T.Group(), k=kit(root), animations=[], storyGroups=[];
  const state={labelOffset:null,movingShadows:false,staged:scene.quality==='schematic'&&scene.items.some(el=>Number.isInteger(el.step))};
  const factory={sphere:()=>new T.SphereGeometry(.5,32,22),cylinder:()=>new T.CylinderGeometry(.5,.5,1,36),cone:()=>new T.ConeGeometry(.5,1,36),capsule:()=>new T.CapsuleGeometry(.26,.48,8,26),torus:()=>new T.TorusGeometry(.36,.14,18,52)};
  for (const el of scene.items) {
    let parent=root;
    if(Number.isInteger(el.step)){parent=new T.Group();root.add(parent);storyGroups.push({obj:parent,step:el.step});}
    if (el.type==='civilJet') {installCivilJet(parent,k,animations,state,context);continue;}
    if (el.type==='turbofan') {installTurbofan(parent,k,animations,state,context);continue;}
    if (el.type==='pcb') {pcb(parent,k,el.variant,animations,state);continue;}
    if (el.type==='fan') {makeFan(parent,k,animations);continue;}
    if (el.type==='tokenStack') {tokenStack(parent,k,animations);continue;}
    if (el.type==='tile') {engineTile(el,parent,k);continue;}
    if (el.type==='arrow' || el.type==='line') {k.arrow(el.p,el.to,el.color,el.width,parent,el.type==='arrow');continue;}
    const {s=[1,1,1],p=[0,0,0],r,color,metal=0,opacity=1}=el;
    let obj;
    if (el.type==='box') {
      const radius= Math.min(...s)*.055;
      obj=k.box(p,s,color,{radius:radius>.025?radius:0,m:metal,opacity,parent});
    } else if (el.type==='plate') {
      const g=new T.ExtrudeGeometry(outline(el.points),{depth:s[1],steps:1,bevelEnabled:false});
      g.rotateX(-Math.PI/2);g.translate(0,-s[1]/2,0);obj=k.mesh(g,k.mat(color,metal,.48,opacity),p,parent);
    } else if (Object.hasOwn(factory,el.type)) {
      obj=k.mesh(k.geo(el.type,factory[el.type]),k.mat(color,metal,.48,opacity),p,parent);obj.scale.set(...s);
    }
    if(r&&obj)obj.rotation.set(...r.map(v=>v*Math.PI/180));
  }
  root.updateMatrixWorld(true);
  const box=state.frame||new T.Box3().setFromObject(root);
  if(scene.view==='camera')box.max.y+=.70;
  return {root,animations,box,state,setStory(step){for(const g of storyGroups)g.obj.visible=step<0||g.step<=step;}};
}

export function disposeModel(root) {
  const geometries=new Set(),materials=new Set();
  root.traverse(obj=>{if(obj.geometry)geometries.add(obj.geometry);if(obj.material)for(const m of [obj.material].flat())materials.add(m); if(obj.isInstancedMesh)obj.dispose();});
  for(const g of geometries)g.dispose();
  for(const m of materials){m.map?.dispose();m.dispose();}
}
