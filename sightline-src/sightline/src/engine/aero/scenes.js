import { BODY, DOMAIN, WING, TAIL, POD } from './airframe.js';

export const labKind=scene=>scene?.view==='wind'?'wind':scene?.view==='turbofan'?'engine':null;
export const ENGINE_DEFAULT={paused:false,section:true,paths:true,speed:57};
const l=(text,at,anchor,detail)=>({text,at,anchor,detail});
const s=(title,note,focus)=>({title,note,focus});
const windSteps=[
  s('Incoming wind','Look at the upstream traces. Crosswind changes their angle before they meet the airframe.',0),
  s('Flow around the wing','The drawing’s planform blocks the 2D slice, so the solved flow bends around it.',1),
  s('Wake and drag','Air pushes the model downwind. The arrow shows that force; the relative drag index comes from momentum exchanged with the silhouette.',2),
];
const engineSteps=[
  s('Intake and fan','The fan accelerates incoming air. Some air enters the core; much of it continues through the outer duct.',0),
  s('Bypass stream','The cool stream travels around the core rather than through the combustion chamber.',1),
  s('Compression','Successive compressor stages raise the pressure of air in the core. The model shows their arrangement, not performance.',2),
  s('Combustion','Conceptually, energy is added to the compressed core air. The orange region marks that stage.',3),
  s('Turbine','The hot stream turns turbine stages. A shaft connects these stages to the front machinery.',4),
  s('Exhaust','Core gas and bypass air leave the rear. The markers indicate direction, not speed or thrust.',5),
];
export const FLOW_FRAME={x:140,y:151,w:720,h:299,minZ:-4.9,maxZ:4.9};
export function windToSvg(x,z){return [FLOW_FRAME.x+(x-DOMAIN.minX)/(DOMAIN.maxX-DOMAIN.minX)*FLOW_FRAME.w,FLOW_FRAME.y+(z-FLOW_FRAME.minZ)/(FLOW_FRAME.maxZ-FLOW_FRAME.minZ)*FLOW_FRAME.h];}
const rect=(x,y,w,h,fill,stroke='none',radius=4,sw=1)=>({type:'rect',x,y,w,h,fill,stroke,radius,sw});
const line=(x,y,ex,ey,stroke,sw=1.8,dash=false)=>({type:'line',x,y,to:[ex,ey],stroke,sw,dash});
const arrow=(x,y,ex,ey,stroke,sw=2.2)=>({...line(x,y,ex,ey,stroke,sw),type:'arrow'});
const circle=(x,y,w,h,fill,stroke='none',sw=1.2)=>({type:'ellipse',x,y,w,h,fill,stroke,sw});
const poly=(points,fill,stroke='none',sw=1.5)=>({type:'poly',points,fill,stroke,sw});
const txt=(x,y,text,size=12,fill='#52695c',align='start',mono=false)=>({type:'text',x,y,text,size,fill,align,mono,weight:620});
function wind2(){
  const body=[...BODY.map(([x,z])=>windToSvg(x,z)),...BODY.slice().reverse().map(([x,z])=>windToSvg(x,-z))];
  const outline=[rect(FLOW_FRAME.x,FLOW_FRAME.y,FLOW_FRAME.w,FLOW_FRAME.h,'none','#9ab2a5',10,1.45)];
  const drawWing=(shape,sign,fill)=>poly(shape.map(([x,z])=>windToSvg(x,z*sign)),fill,'#688b86',1.75);
  return [...outline,txt(158,175,'LIVE FIELD / TOP-VIEW SLICE',10,'#3c665c','start',true),
    ...[-1,1].flatMap(sign=>[drawWing(WING,sign,'#d1ded8'),drawWing(TAIL,sign,'#b5c9c1')]),
    ...[-1,1].map(sign=>{const [x,y]=windToSvg(POD.x-POD.length*.49,sign*POD.z);return rect(x,y-10,56,20,'#87a7a0','#516f69',5);}),
    poly(body,'#f2f3ee','#66827c',1.8),
    line(...windToSvg(-4.35,0),...windToSvg(4.45,0),'#829d94',1.6,true),
    ...[0,1,2,3,4,5,6,7,8,9,10,11].flatMap(i=>[-1,1].map(sign=>{const [x,y]=windToSvg(-3.20+i*.38,sign*.39);return circle(x,y,3.6,3,'#638781');})),
    poly([windToSvg(3.1,-.09),windToSvg(4.55,-.09),windToSvg(4.55,.09),windToSvg(3.1,.09)],'#438377'),
    txt(839,426,'D2Q9  ·  LATTICE UNITS',10,'#51766a','end',true),
  ];
}
function engine2(){
  const cold='#6daea5', hot='#ca8a64', metal='#9aafa9', end='#b9c9bf';
  const items=[
    rect(164,188,673,221,'#e8ede3','#a4b9ab',16,1.7),
    poly([[191,232],[243,214],[466,223],[675,244],[802,260],[819,271],[589,259],[432,245],[234,238],[191,256]],'#bdd4cb','#6f9a90',1.7),
    poly([[191,357],[243,375],[466,366],[675,345],[802,329],[819,318],[589,330],[432,344],[234,351],[191,333]],'#a9c6bb','#6a9487',1.7),
    poly([[225,264],[380,252],[504,271],[644,263],[797,281],[797,309],[644,326],[504,319],[380,337],[225,325]],'#dce5da','#91a99d',1.7),
    line(207,294,801,294,'#5c7f72',3),line(207,298,801,298,'#79988a',1.2,true),
    ...Array.from({length:7},(_,i)=>rect(296+i*20,258+i*1.9,8,76-i*3.8,'#86a99c','#6c8a7d',2,1.25)),
    rect(231,239,15,110,'#779992','#496d63',3,1.5),circle(237,295,26,25,'#d4e4d6','#779990',1.6),
    poly([[453,273],[532,271],[562,284],[562,308],[532,318],[453,315]],'#dbaf90','#a37358',2),
    ...Array.from({length:4},(_,i)=>rect(583+i*21,270-i*2.0,9,51+i*3.6,'#a8a995','#748575',2,1.25)),
    poly([[716,277],[793,277],[810,282],[810,308],[793,313],[716,314]],end,'#7c9a8d',1.7),
    arrow(185,245,335,240,cold,2.8),arrow(379,241,600,251,cold,2.8),arrow(642,254,815,274,cold,2.8),
    arrow(399,289,462,289,hot,3),arrow(510,300,585,299,hot,3),arrow(661,304,813,305,hot,3),
    txt(184,391,'A SECTION THROUGH THE CENTERLINE',10,'#5a796c','start',true),txt(817,391,'CORE + BYPASS',10,'#5a796c','end',true),
  ];return items;
}

export function aeroScene(kind='wind',mode='3d'){
  if(kind==='engine'){
    const labels=mode==='3d'?[
      l('Fan',[-3.56,.81,1.01],[.16,.44],'The broad front fan accelerates the incoming stream.'),
      l('Bypass duct',[-1.8,-1.02,1.29],[.23,.77],'The outer passage carries cooler air around the core.'),
      l('Compressor',[-1.34,.81,.43],[.43,.24],'An alternating set of blade rows compresses air before it enters the combustor.'),
      l('Combustor',[.49,.72,.44],[.64,.24],'This chamber adds heat to the core air. It’s shown schematically.'),
      l('Turbine',[1.71,.60,.41],[.79,.45],'The core stream turns turbine stages that drive the shaft.'),
      l('Exhaust',[3.74,.29,.40],[.82,.77],'The rear passages guide core and bypass flow out of the engine.'),
    ]:[
      l('Fan',[237,260],[.21,.38],'The front fan accelerates incoming air.'),l('Bypass duct',[388,240],[.30,.24],'Cool air moves around the core.'),l('Compressor',[356,293],[.27,.75],'Successive blade rows compress the core air.'),l('Combustor',[508,293],[.53,.27],'Energy is added to the core air.'),l('Turbine',[622,293],[.63,.75],'Turbine stages drive the shaft.'),l('Exhaust',[794,301],[.84,.61],'Both streams leave the engine.'),
    ];
    return {mode,view:'turbofan',quality:'schematic',title:'Turbofan cutaway',subtitle:'A generic civilian engine, sectioned along its centerline',items:mode==='3d'?[{type:'turbofan'}]:engine2(),labels,story:{steps:engineSteps}};
  }
  const labels=mode==='3d'?[
    l('Inflow',[-7.04,.12,-.04],[.133,.42],'The left boundary continually introduces air at the selected wind setting.'),
    l('Wing',[-.10,.01,2.15],[.36,.77],'The outline of the wing is part of the obstacle in this top-view 2D slice.'),
    l('Wake',[5.50,.13,.50],[.826,.54],'The wake is where the flow has changed after passing the silhouette.'),
  ]:[
    l('Inflow',windToSvg(-7.04,-.25),[.125,.53],'Air enters through the prescribed left boundary.'),l('Wing',windToSvg(-.15,2.03),[.34,.72],'The plan-view silhouette is a solid mask.'),l('Wake',windToSvg(5.38,.15),[.835,.60],'The simulated flow and wakes evolve after the air passes the model.'),
  ];
  return {mode,view:'wind',quality:'schematic',title:'Twinjet wind tunnel',subtitle:'A live 2D flow slice mapped to an original civilian aircraft model',items:mode==='3d'?[{type:'civilJet'}]:wind2(),labels,story:{steps:windSteps}};
}
