import { exampleScene } from './examples.js';
import { validatePlan } from './plan.js';

// Colors, shapes, spacing, visual links and playback are all authored here, not by the model.
const PALETTE=[
  {ink:'#386657',edge:'#7b9a89',base:'#d8e9de',hue:'#72ab94',dark:'#356552'},
  {ink:'#3d6580',edge:'#829fb0',base:'#dae7ef',hue:'#7ea9c1',dark:'#425f70'},
  {ink:'#915e47',edge:'#c19279',base:'#f2dfce',hue:'#ce9174',dark:'#825640'},
  {ink:'#6a6583',edge:'#a49ab7',base:'#e5dfec',hue:'#a694bd',dark:'#675b83'},
  {ink:'#7a7143',edge:'#b0a575',base:'#eeebd5',hue:'#bbb071',dark:'#7e7345'},
];
const P=(i)=>PALETTE[i%PALETTE.length];
const rect=(x,y,w,h,fill,stroke='none',radius=9,sw=1.5)=>({type:'rect',x,y,w,h,fill,stroke,radius,sw});
const circle=(x,y,w,h,fill,stroke='none',sw=1.5)=>({type:'ellipse',x,y,w,h,fill,stroke,sw});
const line=(x,y,xx,yy,stroke='#7d9a8d',sw=1.7,dash=false)=>({type:'line',x,y,to:[xx,yy],stroke,sw,dash});
const arrow=(x,y,xx,yy,stroke='#638778',sw=2.3)=>({type:'arrow',x,y,to:[xx,yy],stroke,sw});
const poly=(points,fill,stroke='none',sw=1.6)=>({type:'poly',points,fill,stroke,sw});
const text=(x,y,t,size=16,fill='#30483c',align='start',weight=550,mono=false)=>({type:'text',x,y,text:t,fill,size,align,weight,mono});
const tagged=(items,step)=>items.map(el=>({...el,step}));
const split=(t,w,lines=2)=>{
  const a=[];let row='';
  for(const unit of String(t||'').split(/\s+/).filter(Boolean)){
    const word=unit.length>w?unit.slice(0,w-1)+'…':unit;
    if(row&&(row.length+word.length+1)>w){a.push(row);row=word;}else row=row?row+' '+word:word;
  }
  if(row)a.push(row);
  if(a.length>lines){a.length=lines;a[lines-1]=a[lines-1].slice(0,w-1)+'…';}
  return a;
};
const fig=(y,t)=>[line(144,y+15,856,y+15,'#aebdaf',1.3),text(500,y,t,12,'#5e7769','middle',630,true)];

function icon(form,x,y,p,scale=1){
  const place=items=>items.map(a=>({...a,...(a.x!=null?{x:x+a.x*scale,y:y+a.y*scale}:{}),...(a.to?{to:[x+a.to[0]*scale,y+a.to[1]*scale]}:{}),...(a.points?{points:a.points.map(([dx,dy])=>[x+scale*dx,y+scale*dy])}:{}),...(a.w!=null?{w:a.w*scale,h:a.h*scale}:{}),...(a.sw?{sw:a.sw*scale}:{}),...(a.radius?{radius:a.radius*scale}:{})}));
  const {ink,edge,base,hue}=p;
  let marks;
  switch(form){
  case 'chip': marks=[rect(-12,-12,24,24,hue,ink,3),rect(-7,-7,14,14,base,ink,2),...[ -6,0,6].flatMap(i=>[line(i,-16,i,-12,ink,1.4),line(i,12,i,16,ink,1.4),line(-16,i,-12,i,ink,1.4),line(12,i,16,i,ink,1.4)])];break;
  case 'pin':marks=[rect(-5,-10,10,24,hue,ink,4),circle(0,-10,23,10,base,ink),circle(0,-10,7,3,hue,ink,1)];break;
  case 'ring':marks=[circle(0,0,27,27,hue,ink),circle(0,0,15,15,base,ink),poly([[8,-14],[13,-12],[16,-9]],'none',edge)];break;
  case 'tube':marks=[rect(-13,-8,27,16,hue,ink,5),circle(-12,0,10,16,base,ink),circle(14,0,10,16,hue,ink),circle(14,0,5,9,base,ink,1)];break;
  case 'screen':case 'panel': marks=[rect(-16,-11,32,21,hue,ink,4),rect(-12,-7,24,13,base,edge,2),line(-5,14,6,14,ink,2),line(0,10,0,14,ink,1.8)];break;
  case 'flow':marks=[arrow(-13,-7,12,-7,ink,1.8),arrow(-16,1,17,1,ink,2.2),arrow(-10,9,10,9,edge,1.7)];break;
  case 'sphere':marks=[circle(0,0,28,28,hue,ink),circle(0,0,13,28,'none',ink),line(-13,0,13,0,ink,1.3)];break;
  case 'board':marks=[rect(-16,-11,32,22,hue,ink,4),rect(-7,-5,13,10,base,ink,2),circle(-12,-7,3.2,3.2,base),circle(12,7,3.2,3.2,base),line(7,-4,13,-4,ink,1.3),line(7,0,13,0,ink,1.3),line(7,4,13,4,ink,1.3)];break;
  default:marks=[poly([[-15,-5],[0,-14],[15,-5],[0,4]],base,ink),poly([[-15,-5],[0,4],[0,16],[-15,6]],hue,ink),poly([[15,-5],[0,4],[0,16],[15,6]],edge,ink)];
  }
  return place(marks);
}
function card(part,i,x,y,w,h){
  const p=P(i), n=`${i+1}`.padStart(2,'0');
  const name=split(part.name,Math.floor((w-25)/9.2),2), notes=split(part.note,Math.floor((w-25)/5.9),2);
  return tagged([
    {...rect(x+2,y+5,w,h,'#6e8b7b','none',13),opacity:.19},rect(x,y,w,h,'#f5f5ec','#a6b8a8',13),
    rect(x+10,y+10,w-20,52,p.base,'none',8),circle(x+34,y+36,39,38,'#f4f6eb',p.edge),...icon(part.form,x+34,y+36,p,.90),
    text(x+w-22,y+38,n,11,p.ink,'end',690,true),
    ...name.map((s,j)=>text(x+13,y+91+j*18,s,17,p.ink,'start',720)),
    ...notes.map((s,j)=>text(x+13,y+115+(name.length>1?14:0)+j*14,s,11.6,'#526459','start',510)),
  ],i);
}
function linear2(parts,kind,guide){
  const n=parts.length,w=Math.min(kind==='comparison'?280:213,Math.floor((800-(n-1)*32)/n)),g=n===2?58:32;
  const left=(1000-(n*w+(n-1)*g))/2,y=213;
  const labels={process:'SEQUENCE / READ LEFT TO RIGHT',comparison:'COMPARISON / SIDE BY SIDE',assembly:'ASSEMBLY / IN ORDER',hierarchy:'STRUCTURE / OVERVIEW'};
  const items=[text(500,167,labels[kind]||'SYSTEM / OVERVIEW',12,'#668173','middle',630,true),...fig(433,kind==='comparison'?'COMPARE THE KEY FEATURES':'SELECT A STEP TO EXPLORE')];
  parts.forEach((pt,i)=>{
    const x=left+i*(w+g);
    guide.push([x+34,y+36]);
    if(i>0&&kind!=='comparison')items.push(...tagged([arrow(x-g+3,y+77,x-4,y+77)],i));
    if(i>0&&kind==='comparison')items.push(circle(x-g/2,y+79,25,25,'#e5e9dd','#a9b9a8'),text(x-g/2,y+83,'VS',9,'#62796b','middle',690,true));
    items.push(...card(pt,i,x,y,w,153));
  });
  return items;
}
function anatomy2(parts,kind,guide){
  const n=parts.length,center=[500,291];
  const items=[circle(...center,184,184,'#ecf0e5','#aebcad',1.6),circle(...center,151,151,'#e3ebe0','#b6c7b7',1),
    ...icon(parts[0]?.form||'board',500,291,P(0),3.2),text(500,420,kind==='forces'?'DIRECTION AND INTERACTION':'PARTS / CONNECTIONS',12,'#637b6d','middle',640,true)];
  parts.forEach((pt,i)=>{
    const left=i%2===0,j=Math.floor(i/2),rows=left?Math.ceil(n/2):Math.floor(n/2),y=rows===1?263:188+j*83,x=left?137:658;
    const c=P(i),nodeX=left?x+205:x,targetX=left?425:575,aimY=291+(y-255)*.4;
    guide.push([x+27.5,y+29]);
    const connector=kind==='forces'?arrow(nodeX,y+27,targetX,aimY,c.ink,2.4):line(nodeX,y+27,targetX,aimY,c.edge,1.6);
    const note=split(pt.note,25,2);
    items.push(...tagged([connector,circle(targetX,aimY,7,7,'#eef2e8',c.ink,1.3),rect(x,y,205,57,'#f5f6ee',c.edge,8),rect(x+10,y+11,35,35,c.base,'none',6),...icon(pt.form,x+27.5,y+29,c,.7),text(x+53,y+22,split(pt.name,20,1)[0]||'',13,c.ink,'start',710),...note.map((s,k)=>text(x+53,y+36+k*12,s,9.7,'#536958'))],i));
  });
  return items;
}
function cycle2(parts,guide){
  if(parts.length<3)return linear2(parts,'process',guide);
  const n=parts.length,cx=500,cy=292;
  const nodes=parts.map((_,i)=>{const theta=-Math.PI*.5+2*Math.PI*i/n;return [cx+Math.cos(theta)*267,cy+Math.sin(theta)*101];});
  const items=[circle(cx,cy,318,138,'none','#abbeb0',1.7),circle(cx,cy,125,74,'#e3ede1','#9eb6a6',1.5),text(cx,cy+5,'↻  REPEAT',14,'#557b6c','middle',675,true)];
  nodes.forEach(([x,y],i)=>{
    const [ex,ey]=nodes[(i+1)%n],dx=ex-x,dy=ey-y,t=Math.min(.4,85/Math.max(1,Math.abs(dx)),28/Math.max(1,Math.abs(dy))),u=Math.min(.4,103/Math.max(1,Math.abs(dx)),40/Math.max(1,Math.abs(dy)));
    items.push(arrow(x+dx*t,y+dy*t,ex-dx*u,ey-dy*u,P(i).edge,2.4));
  });
  nodes.forEach(([x,y],i)=>{
    guide.push([x-53,y]);
    const p=P(i),pt=parts[i];items.push(...tagged([rect(x-77,y-26,154,52,'#f4f6ec',p.edge,9),circle(x-53,y,29,29,p.base),...icon(pt.form,x-53,y,p,.58),...split(pt.name,15,2).map((s,j)=>text(x-32,y+(j?13:-3),s,12,p.ink,'start',680))],i));
  });
  return items;
}
function compile2(plan){
  const {parts,kind}=plan;
  if(kind==='unclear')return {items:[...fig(378,'WAITING FOR A CLEAR SUBJECT'),rect(347,204,306,116,'#f2f4e9','#a6baac',12),text(500,247,'Share a closer view',22,'#3f6252','middle',670),text(500,279,'or describe the concept in your prompt.',13,'#607d6d','middle',520)],labels:[]};
  const guide=[];
  let items;
  if(kind==='anatomy'||kind==='forces'||kind==='hierarchy')items=anatomy2(parts,kind,guide);
  else if(kind==='cycle')items=cycle2(parts,guide);
  else items=linear2(parts,kind,guide);
  return {items,labels:[],guide};
}
function labelAnchor(i,n,kind){
  if(n===1)return [.80,.34];
  if(kind==='process'||kind==='comparison'){
    if(n===2)return i?[.84,.67]:[.16,.36];
    return [.18+.66*i/(n-1),i===0?.34:i===n-1?.73:i%2?.245:.765];
  }
  if(kind==='assembly')return [i%2?.82:.18,.70-i*.107];
  return [i%2?.84:.16,n===2?.57:.36+Math.floor(i/2)*.17];
}
function compile3(plan){
  const {parts,kind}=plan;
  if(kind==='unclear')return {items:[{type:'tile',form:'screen',p:[0,0,0],s:[3.45,.3,3.1],color:'#8bad97',index:0,label:'CLEARER VIEW'}],labels:[]};
  const n=parts.length, items=[],labels=[];
  if(['assembly','anatomy','hierarchy','forces'].includes(kind)){
    items.push({type:'box',p:[0,-.36,0],s:[n>3?9:7.9,.32,5.3],color:'#718b7b',metal:.1});
    items.push({type:'box',p:[0,-.167,0],s:[n>3?8.65:7.55,.08,4.95],color:'#d2dfce',metal:.06});
  }
  const positions=parts.map((_,i)=>{
    if(kind==='cycle'){const t=-Math.PI*.5+2*Math.PI*i/n;return [Math.cos(t)*3.85,0,Math.sin(t)*2.68];}
    if(kind==='assembly')return [(i-(n-1)/2)*.78,i*.79,(1-i%2)*.36];
    if(kind==='anatomy'||kind==='forces'||kind==='hierarchy'){
      if(i===0)return [0,.08,0];
      const layout=[[-2.75,0,.88],[2.75,0,-.79],[-1.86,0,-1.70],[2.06,0,1.74]];
      return layout[i-1];
    }
    return [(i-(n-1)/2)*(kind==='comparison'?2.8:2.65),.02,(i%2-.5)*.27];
  });
  parts.forEach((part,i)=>{
    const p=positions[i], c=P(i), compact=['hierarchy','anatomy','forces'].includes(kind)&&i>0, scale=compact?.86:1;
    items.push({type:'tile',p,s:[1.93*scale,.28,1.70*scale],form:part.form,index:i+1,step:i,color:c.hue,label:(part.name.length>16?part.name.slice(0,15)+'…':part.name).toUpperCase()});
    labels.push({text:part.name,detail:part.note||`Part ${i+1} of the illustration.`,at:[p[0],p[1]+.70,p[2]+.12],anchor:labelAnchor(i,n,kind)});
    let to=null;
    if (kind==='cycle'&&n>2)to=positions[(i+1)%n];
    if (kind==='process'&&i+1<n)to=positions[i+1];
    if(['anatomy','hierarchy','forces'].includes(kind)&&i>0)to=positions[0];
    if(to){const [x,y,z]=p, [xx,yy,zz]=to, dist=Math.hypot(xx-x,zz-z), a=Math.min(.41,.89/Math.max(.001,dist));items.push({type:kind==='anatomy'||kind==='hierarchy'?'line':'arrow',p:[x+(xx-x)*a,Math.max(y,yy)+.18,z+(zz-z)*a],to:[xx-(xx-x)*a,Math.max(y,yy)+.18,zz-(zz-z)*a],color:c.dark,width:.077,step:kind==='process'?i+1:i});}
  });
  return {items,labels};
}

export const FILTER_PLAN={kind:'process',title:'Water filtration',summary:'From intake to cleaner water, one stage at a time.',asset:'none',parts:[
  {name:'Intake',note:'Water enters the treatment system.',form:'tube'},
  {name:'Filter bed',note:'Porous media traps suspended particles.',form:'panel'},
  {name:'Outlet',note:'Filtered water leaves through the outlet.',form:'flow'},
]};

const knownAsset={pi5:['pi',null],pi_camera:['pi','camera'],next_token:['tokens',null],axial_fan:['fan',null]};
export function editorialExample(id,mode,variant){
  const base=exampleScene(id,mode,variant);
  if(id==='lab')return base;
  const set=(title,note,focus=null)=>({title,note,focus});
  let steps,items=base.items;
  if(id==='tokens'){
    steps=[set('First context','The model sees token 18. Its target is the next token, 47.',mode==='3d'?0:null),set('Extend the input','Add 47 to the context; now the correct next token is 56.'),set('Predict and compare','Repeat on longer contexts and adjust weights from the prediction error.',mode==='3d'?1:null)];
    const target=mode==='2d'?[[720,200],[720,281],[720,361]]:[[-3.53,.51,-2.09],[-2.10,.51,0],[3.59,.51,2.09]];
    steps=steps.map((s,i)=>({...s,point:target[i]}));
    if(mode==='2d'){
      items=items.map(item=>({...item,...(item.y>=170&&item.y<389?{step:item.y<247?0:item.y<328?1:2}:{})}));
      items.push({...text(913,198,'known',22,'#a66d4d','middle',500),hand:true,step:0},{...text(911,218,'answer',22,'#a66d4d','middle',500),hand:true,step:0},...tagged([poly([[884,211],[858,218],[817,206]],'none','#ad8068',1.8),arrow(817,206,788,201,'#ad8068',1.65)],0));
    }
  }else if(id==='fan'){
    steps=[set('Air enters','The shroud guides air into the fan along its axis.',mode==='3d'?1:null),set('Blades rotate','Angled blades push the air along the fan’s axis.',mode==='3d'?0:null),set('Flow exits','A moving stream leaves the front. The arrows show direction, not a simulation.',mode==='3d'?2:null)];
    if(mode==='2d'){steps=steps.map((s,i)=>({...s,point:[[292,285],[492,283],[716,285]][i]}));items=items.map(e=>e.type==='arrow'?{...e,step:e.x<400?0:2}:e);}
  }else if(variant==='camera'){
    steps=[set('Open the latch','Power off the Pi. Lift the CAM/DISP latch before inserting the ribbon.',mode==='3d'?2:null),set('Seat the ribbon','Use the matching 22-pin end. Align it straight with the connector.',mode==='3d'?1:null),set('Lock in place','Close the latch without forcing it, then check that the ribbon is straight.',mode==='3d'?0:null)];
    if(mode==='2d'){steps=steps.map((s,i)=>({...s,point:[[226,269],[484,272],[727,266]][i]}));items=items.map(e=>e.x>=108&&e.x<888?{...e,step:e.x<358?0:e.x<625?1:2}:e);}
  }else{
    steps=[set('Processing','The central BCM2712 system-on-chip runs the software.',1),set('I/O and networking','The GPIO header, USB and Ethernet connect the board to other devices.',0),set('Camera and display','Ribbon-cable connectors link compact camera and display modules.',3)];
  }
  return {...base,items,story:{steps},quality:'asset'};
}
export function compilePlan(input,mode){
  const plan=validatePlan(input);
  if(mode!=='3d'&&mode!=='2d')throw new Error('Choose a 2D or 3D renderer.');
  if(Object.hasOwn(knownAsset,plan.asset)){
    const [sample,variant]=knownAsset[plan.asset];
    return editorialExample(sample,mode,variant);
  }
  const {guide,...drawing}=mode==='2d'?compile2(plan):compile3(plan);
  return {mode,title:plan.title,subtitle:plan.summary||(mode==='3d'?'Schematic illustration, not an exact reconstruction':'An explanatory diagram'),...drawing,
    quality:'schematic', ...(plan.parts.length?{story:{steps:plan.parts.map(({name,note},i)=>({title:name,note,focus:mode==='3d'?i:null,...(guide?.[i]?{point:guide[i]}:{})}))}}:{})};
}
