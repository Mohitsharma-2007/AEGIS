import { aeroScene } from './aero/scenes.js';

const rect = (x,y,w,h,fill,stroke='none',radius=9,sw=2) => ({type:'rect',x,y,w,h,fill,stroke,radius,sw});
const ellipse = (x,y,w,h,fill,stroke='none',sw=2) => ({type:'ellipse',x,y,w,h,fill,stroke,sw});
const text = (x,y,t,size=21,fill='#344942',align='start',weight=550,mono=false) => ({type:'text',x,y,text:t,size,fill,align,weight,mono});
const arrow = (x,y,tx,ty,stroke='#647872',sw=2) => ({type:'arrow',x,y,to:[tx,ty],stroke,sw});
const line = (x,y,tx,ty,stroke='#647872',sw=2,dash=false) => ({type:'line',x,y,to:[tx,ty],stroke,sw,dash});
const poly = (points,fill,stroke='none',sw=2) => ({type:'poly',points,fill,stroke,sw});
const l = (text,at,anchor,detail) => ({text,at,anchor,detail});

export const EXAMPLES = [
  {id:'pi', name:'Raspberry Pi 5', kind:'Hardware', source:'/examples/pi.svg', mode:'3d', prompt:'Label the main components on this Raspberry Pi 5.'},
  {id:'tokens', name:'Next-token prediction', kind:'Machine learning', source:'/examples/tokens.svg', mode:'2d', prompt:'Show how known next tokens become training targets.'},
  {id:'fan', name:'How a fan moves air', kind:'Physics', source:'/examples/fan.svg', mode:'3d', prompt:'Visualize how a fan pushes air forward.'},
  {id:'lab', name:'Airflow lab', kind:'Wind tunnel + turbofan', source:'/examples/lab.svg', mode:'3d', prompt:'Explore the civilian twinjet wind tunnel.'},
  {id:'filter', name:'Water filtration', kind:'Engine recipe', source:'/examples/filter.svg', mode:'3d', prompt:'Draw a diagram of water filtration.'},
];

const piLabels = [
  l('40-pin GPIO',[-.1,.54,-2.78],[.661,.187],'The general-purpose input/output header connects sensors, displays, and other small peripherals.'),
  l('ARM processor',[-1.40,.43,-.06],[.181,.405],'The BCM2712 is the Pi 5’s main system-on-chip. It includes a quad-core Arm Cortex-A76 CPU.'),
  l('USB 3.0',[4.92,.92,-1.55],[.833,.445],'The two blue USB 3.0 ports connect high-speed accessories, such as an external drive.'),
  l('Camera connector',[-1.13,.21,2.49],[.215,.749],'The Pi 5 has small ribbon-cable connectors for compatible camera or display modules.'),
  l('Gigabit Ethernet',[4.78,.98,2.12],[.788,.746],'A wired network jack rated for up to 1 gigabit per second.'),
];
const cameraLabels = [
  l('Camera module',[-1.00,2.98,2.57],[.69,.224],'The ribbon bridges the camera module and the small camera/display connector on the Pi.'),
  l('Ribbon cable',[-1.13,1.44,2.49],[.75,.47],'Use a cable with the correct ends for your Pi and camera; the Pi 5 uses a narrow 22-pin board-side connector.'),
  l('CAM/DISP connector',[-1.13,.21,2.49],[.19,.735],'With the Pi powered off, lift the latch gently, seat the cable in the correct orientation, then close the latch.'),
];
const pi3 = {
  mode:'3d',view:'pcb', title:'Raspberry Pi 5', subtitle:'Anatomy of a single-board computer', items:[{type:'pcb'}], labels:piLabels,
};
const camera3 = {
  mode:'3d',view:'camera', title:'Connect a Pi camera', subtitle:'A ribbon-cable connection, illustrated', items:[{type:'pcb',variant:'camera'}], labels:cameraLabels,
};
const piTop = [
  rect(250,135,506,303,'#28674e','#1b523d',18,2.4), rect(256,140,494,291,'#3e8765','#75a786',14,1.4),
  ...[[277,163],[727,163],[277,410],[727,410]].flatMap(([x,y])=>[ellipse(x,y,24,24,'#ccad60','#e1cc91',2),ellipse(x,y,14,14,'#e8eadd')]),
  rect(345,159,318,32,'#1c312e','none',4),
  ...Array.from({length:20},(_,i)=>[rect(355+i*15,166,6,6,'#dcbd6b','none',1),rect(355+i*15,177,6,6,'#dcbd6b','none',1)]).flat(),
  poly([[339,247],[331,223],[321,223],[321,201]],'none','#76ab86',2.4),poly([[497,245],[561,215],[642,215],[668,229]],'none','#74b08b',2.4),
  poly([[495,320],[569,348],[647,348],[668,371]],'none','#75aa79',2.4),poly([[523,284],[553,312],[642,312],[666,295]],'none','#8dbb85',2.4),
  rect(356,230,112,104,'#234440','#192f2b',7),rect(368,241,88,81,'#d8ddce','#b0b9ad',5),text(412,287,'BCM2712',14,'#53655c','middle',610,true),
  rect(491,255,71,55,'#233c37','none',5),text(526,289,'RAM',13,'#c0c9b6','middle',500,true),
  rect(716,210,60,66,'#bfc9c0','#768781',5),rect(757,220,20,45,'#297395','none',2),
  rect(716,281,60,63,'#bdc8bf','#768781',5),rect(757,292,20,41,'#243e3c','none',2),
  rect(706,351,70,66,'#c5cec2','#768781',5),rect(756,359,20,49,'#344843','none',2),
  rect(347,393,99,18,'#ded2a5','#ad9c66',4),rect(357,396,78,5,'#31463a','none',1),
  rect(533,387,46,47,'#b5c4b9','#687b70',5),rect(600,390,44,44,'#b5c4b9','#687b70',5),
  ...[[302,281],[319,295],[323,361],[452,380],[560,216],[576,216],[607,327],[619,327],[632,327],[646,327],[582,361],[595,361],[610,361]].map(([x,y])=>rect(x,y,7,9,'#d4b971','none',1)),
];
const pi2 = {
  mode:'2d',view:'pcb',title:'Raspberry Pi 5',subtitle:'A top-down map of the connectors and chips',items:piTop,
  labels:[l('40-pin GPIO',[610,176],[.67,.225],piLabels[0].detail),l('ARM processor',[388,281],[.175,.47],piLabels[1].detail),l('USB 3.0',[762,243],[.863,.452],piLabels[2].detail),l('Camera connector',[378,400],[.177,.768],piLabels[3].detail),l('Gigabit Ethernet',[753,387],[.866,.758],piLabels[4].detail)],
};
const camera2 = {
  mode:'2d',view:'camera',title:'Connect a Pi camera',subtitle:'Power off the Pi before connecting or removing the ribbon cable.',labels:[],items:[
    rect(84,160,832,237,'#e8ecdf','#b6c0ad',16,1.4),
    ...[[110,'01','Lift the latch','Open the CAM/DISP latch gently.'],[376,'02','Seat the ribbon','Use the correct 22-pin end.'],[642,'03','Lock in place','Close the latch before power-on.']].flatMap(([x,n,t,s])=>[
      rect(x,187,242,183,'#f7f7ef','#bdc9ba',10,1.4),text(x+21,222,n,15,'#a5553a','start',650,true),
      rect(x+30,276,175,30,'#367658','none',5),rect(x+71,265,93,17,'#ccb98d','#8b7b54',3),
      line(x+81,270,x+150,270,'#32483b',3),text(x+21,332,t,21,'#2b4036','start',700),text(x+21,353,s,12,'#5e7165'),
    ]), arrow(226,263,226,235,'#a85e46',2.2), rect(471,230,50,36,'#d4b76e','none',3), arrow(532,234,532,261,'#a85e46',2.2), rect(736,233,50,35,'#d4b76e','none',3), line(736,266,786,266,'#454f45',4),
  ],
};
const token2 = {mode:'2d',view:'tokens',title:'Next-token prediction',subtitle:'Turn a sequence into examples with a known next token',labels:[],items:[
  text(235,147,'INPUT CONTEXT',14,'#537169','start',650,true),text(677,147,'NEXT TOKEN',14,'#916849','start',650,true),
  ...[[173,['18'],'47'],[254,['18','47'],'56'],[335,['18','47','56'],'57']].flatMap(([y,nums,target],i) => [
    text(182,y+32,`0${i+1}`,14,'#809286','middle',560,true),
    ...nums.flatMap((n,k)=>[rect(235+k*80,y,70,54,'#cfdfed','#799bac',7,1.5),text(270+k*80,y+34,n,22,'#315670','middle',630,true)]),
    arrow(489,y+27,642,y+27,'#70857a',2.2),rect(679,y,82,54,'#f2d0bf','#c79780',7,1.5),text(720,y+34,target,22,'#88533d','middle',630,true),
  ]),
  line(178,422,819,422,'#a7b4a7',1.6),text(500,457,'Predict  →  Compare  →  Adjust weights',19,'#4f685c','middle',560),
]};
const token3 = {mode:'3d',view:'tokens',title:'Next-token prediction',subtitle:'Each longer prefix gives the model another training example',items:[{type:'tokenStack'}],labels:[
  l('Input context',[-2.8,.6,.7],[.17,.44],'The input is the prefix of tokens the model can see.'),
  l('Training target',[3.85,.65,-.1],[.83,.53],'The target is the real token immediately following that prefix.'),
]};
const fan3 = {mode:'3d',view:'fan',title:'How a fan moves air',subtitle:'Angled blades move air through the shroud',items:[{type:'fan'}],labels:[
  l('Angled blades',[.9,1.25,.03],[.672,.23],'Rotating, pitched blades exert a force on the air and move it along the fan’s axis.'),
  l('Air intake',[-1.42,1.18,-2.8],[.22,.46],'Air is drawn toward the low-pressure side of the fan.'),
  l('Forward airflow',[1.32,1.38,3.15],[.807,.72],'Air leaves the front of the fan as a moving stream.'),
]};
const fan2 = {mode:'2d',view:'fan',title:'How a fan moves air',subtitle:'A side view of the flow through an axial fan',labels:[],items:[
  rect(405,168,180,239,'#dce6d8','#7e9e88',15,2),line(405,202,585,202,'#759883',9),line(405,372,585,372,'#759883',9),
  line(482,207,482,369,'#446454',3),ellipse(493,286,50,48,'#486f5e'),poly([[479,269],[519,212],[536,214],[507,277]],'#6d9581','#4b7763'),poly([[509,301],[475,363],[459,362],[480,303]],'#6d9581','#4b7763'),
  ...[242,286,331].flatMap((y)=>[arrow(177,y,392,y,'#69a9a0',4),arrow(598,y,817,y,'#438c83',5)]),
  text(268,447,'AIR INTAKE',15,'#527b72','middle',650,true),text(494,447,'BLADE + MOTOR',15,'#426b5b','middle',650,true),text(712,447,'AIRFLOW OUT',15,'#386f65','middle',650,true),
]};

export function exampleScene(id, mode, variant) {
  if (id === 'lab') return aeroScene(variant==='engine'?'engine':'wind',mode);
  if (id === 'tokens') return mode === '2d' ? token2 : token3;
  if (id === 'fan') return mode === '2d' ? fan2 : fan3;
  if (variant === 'camera') return mode === '2d' ? camera2 : camera3;
  return mode === '2d' ? pi2 : pi3;
}

// Useful quick prompts in Demo mode. Unrecognized requests are not presented as AI responses.
export function demoAnswer(query, active, mode) {
  const q = query.trim().toLowerCase();
  if (/\b(turbofan|engine cutaway|cutaway engine|bypass duct)\b/.test(q)) return {id:'lab',variant:'engine',scene:aeroScene('engine',mode)};
  if (/\b(wind tunnel|airflow lab|civilian twinjet|wind around the airplane)\b/.test(q)) return {id:'lab',variant:'wind',scene:aeroScene('wind',mode)};
  if (/\b(label|explain|visualize)\b/.test(q) && /\b(main components|this|current example)\b/.test(q) && !/camera|attach|connect/.test(q)) {
    return {id:active, scene:exampleScene(active,mode)};
  }
  if (/next[- ]?token|\b(tensor|transformer|llm)\b|language model|training target/.test(q)) return {id:'tokens',scene:exampleScene('tokens',mode)};
  if (/\bfan\b|airflow|air flow|blades/.test(q)) return {id:'fan',scene:exampleScene('fan',mode)};
  if (/camera|ribbon cable|cam\/disp/.test(q) && (active === 'pi' || /raspberry|\bpi 5\b/.test(q))) return {id:'pi',variant:'camera',scene:exampleScene('pi',mode,'camera')};
  if (/raspberry|\bpi 5\b|\bgpio\b|single.board/.test(q)) return {id:'pi',scene:exampleScene('pi',mode)};
  return null;
}

export function quickDrawing(query, mode) {
  const q = query.replace(/^\s*(?:draw|show|make|create)\s+(?:a\s+)?(?:flowchart(?:\s+(?:of|for))?\s*[:\-]?\s*)?/i, '').trim();
  if (/→|->/.test(q)) {
    const nodes = q.split(/\s*(?:→|->)\s*/).filter(Boolean).slice(0,5).map(s=>s.trim().slice(0,27));
    if (nodes.length < 2) return null;
    const step = Math.min(195,770/nodes.length), bw=step-31, left=500-(step*(nodes.length-1)+bw)/2;
    const palette = ['#bedbd2','#cbdeed','#eaccb9','#d8d8b9','#ddccdf'];
    const items = nodes.flatMap((n,i) => {
      const x=left+i*step;
      return [rect(x,228,bw,86,palette[i],'#76877e',10,1.5),text(x+bw/2,277,n,Math.min(22,(bw-12)/(Math.max(n.length,1)*.56)),'#32483f','middle',650),...(i<nodes.length-1?[arrow(x+bw+5,271,x+step-8,271,'#748c80',2)]:[])];
    });
    if (mode==='2d') return {mode,title:'Process flow',subtitle:'Built locally from your arrow-separated steps',items,labels:[]};
    const solids=nodes.flatMap((n,i)=>{
      const x=(i-(nodes.length-1)/2)*2.15;
      return [{type:'box',p:[x,0,0],s:[1.62,.84,1.40],color:palette[i]},...(i<nodes.length-1?[{type:'arrow',p:[x+.88,.05,0],to:[x+1.32,.05,0],color:'#547568',width:.06}]:[])];
    });
    const labels=nodes.map((n,i)=>l(n,[(i-(nodes.length-1)/2)*2.15,.45,0],[.18+.64*(i/(nodes.length-1)), i%2 ? .72:.30],`Step ${i+1} of ${nodes.length}`));
    return {mode,title:'Process flow',subtitle:'Built locally from your arrow-separated steps',items:solids,labels};
  }
  const named = /^(?:(red|green|blue|orange|purple)\s+)?(cube|box|sphere|circle|cylinder|cone|ring|torus|circle|triangle|rectangle|square)[.!]?$/i.exec(q);
  if (!named) return null;
  const name=named[2].toLowerCase(), fill={red:'#d57460',green:'#4c9b78',blue:'#5b90b6',orange:'#e09961',purple:'#947db0'}[named[1]?.toLowerCase()] || '#65a58b';
  const title=name[0].toUpperCase()+name.slice(1);
  if (mode === '3d') {
    const type={cube:'box',rectangle:'box',square:'box',circle:'cylinder',triangle:'cone',ring:'torus'}[name]||name;
    return {mode,title,subtitle:'A primitive drawn by the local geometry engine',items:[{type,p:[0,0,0],s:name==='rectangle'?[5,2,2]:name==='circle'?[4,.25,4]:[4,4,4],color:fill}],labels:[]};
  }
  const item = ['sphere','circle','ring','torus','cylinder'].includes(name) ? ellipse(500,273,215,215,['ring','torus'].includes(name)?'none':fill,fill,16) : ['triangle','cone'].includes(name) ? poly([[500,156],[360,362],[640,362]],fill) : rect(name==='rectangle'?350:400,170,name==='rectangle'?300:200,200,fill,'none',6);
  return {mode,title,subtitle:'A primitive drawn by the local geometry engine',items:[item],labels:[]};
}
