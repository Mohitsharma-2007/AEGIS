import { DOMAIN, worldAt } from './airframe.js';
import { sampleVector } from './solver.js';
const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
// Trace integration follows the actual snapshot velocity field, not the aircraft outline.
export function makeTraces(field,count=32,extra=8){
  if(!field?.data)return [];
  const {nx,ny}=field,out=[],v=[0,0,0],mid=[0,0,0];
  for(let i=0;i<count+extra;i++){
    const upstream=i<count;
    let x=upstream?1.18:Math.floor(nx*.58)+(i%2)*3.0;
    let y=upstream?(i+.76)*(ny-2)/(count+.4):ny*(.32+((i-count+.4)/extra)*.36);
    const vertices=[];
    for(let j=0;j<194;j++){
      sampleVector(field,x,y,v);
      const u=v[0],w=v[1],mag=Math.hypot(u,w);
      if(v[2]||mag<.0032||x>=nx-2)break;
      const [wx,wz]=worldAt(x,y,nx,ny);
      vertices.push([x,y,wx,wz,mag]);
      const scale=.94/mag;
      sampleVector(field,x+u*scale*.50,y+w*scale*.50,mid);
      if(mid[2])break;
      const midmag=Math.hypot(mid[0],mid[1]);
      if(midmag<.0025)break;
      const vx=mid[0]*.94/midmag,vy=mid[1]*.94/midmag;
      x+=vx;y+=vy;
    }
    if(vertices.length>4)out.push({points:vertices,offset:i*.213,upstream});
  }
  return out;
}
export function fieldColor(field,index,layer,out,offset,alpha=1){
  if(layer==='lines'||field.data[index+3]){out[offset]=out[offset+1]=out[offset+2]=out[offset+3]=0;return;}
  const speed=Math.hypot(field.data[index],field.data[index+1])/Math.max(.018,field.inlet);
  if(layer==='wake'){
    const curl=field.data[index+2], v=clamp(Math.abs(curl)*24);
    out[offset]=curl>=0?223:74;out[offset+1]=curl>=0?131:145;out[offset+2]=curl>=0?91:185;out[offset+3]=Math.round((.04+.65*Math.sqrt(v))*255*alpha);
  }else{
    const t=clamp((speed-.61)*.83);
    if(t<.50){const u=t*2;out[offset]=73+57*u;out[offset+1]=126+58*u;out[offset+2]=163+10*u;}
    else{const u=(t-.5)*2;out[offset]=130+107*u;out[offset+1]=184-17*u;out[offset+2]=173-83*u;}
    const strength=.20+Math.min(.72,Math.abs(speed-1)*.9);
    out[offset+3]=Math.round(strength*255*alpha);
  }
}
export function colorize(field,layer,array,alpha=1,softEdge=false){
  const {nx,ny}=field;
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const p=(x+y*nx)*4;
    let fade=alpha;
    if(softEdge){const edge=Math.min(x,nx-1-x,y,ny-1-y);fade*=Math.min(1,edge/9);}
    fieldColor(field,p,layer,array,p,fade);
  }
  return array;
}
export const WORLD_RANGE=[DOMAIN.maxX-DOMAIN.minX,DOMAIN.maxZ-DOMAIN.minZ];

// Passive teaching markers advect through the updated velocity field. The display
// clock is accelerated so the motion is legible. It does not represent flight time.
export class FlowParticles {
  constructor(count=164){
    this.p=new Float32Array(count*3);this.count=count;this.random=2781447;this.ready=false;this.tick=-1;
    this.probe=[0,0,0];this.mid=[0,0,0];
  }
  rand(){this.random=(Math.imul(this.random,1664525)+1013904223)>>>0;return this.random/4294967296;}
  seed(i,field,scatter){
    const {nx,ny}=field;const j=i*3,wake=i%5===0;
    let x,y;
    for(let t=0;t<20;t++){
      x=scatter?1+(nx-4)*this.rand():wake?nx*(.63+.28*this.rand()):1.2+this.rand()*2.2;
      y=!scatter&&wake?ny*(.34+.32*this.rand()):1+(ny-3)*this.rand();
      sampleVector(field,x,y,this.probe);
      if(!this.probe[2])break;
    }
    this.p[j]=x;this.p[j+1]=y;this.p[j+2]=this.rand()*.92;
  }
  move(field,dt=0){
    if(!this.ready||field.tick<this.tick){this.random=2781447;for(let i=0;i<this.count;i++)this.seed(i,field,true);this.ready=true;}
    this.tick=field.tick;
    if(dt<=0)return this.p;
    const {nx,ny}=field,p=this.p,probe=this.probe,mid=this.mid;
    for(let i=0;i<this.count;i++){
      const j=3*i,x=p[j],y=p[j+1];
      sampleVector(field,x,y,probe);
      const delta=dt*690, k=Math.min(delta,1.15/Math.max(.001,Math.hypot(probe[0],probe[1])));
      sampleVector(field,x+probe[0]*k*.5,y+probe[1]*k*.5,mid);
      const a=x+mid[0]*k,b=y+mid[1]*k;
      if(probe[2]||mid[2]||a>=nx-2||a<1||b<1||b>=ny-2||p[j+2]>1){this.seed(i,field,false);continue;}
      p[j]=a;p[j+1]=b;p[j+2]+=dt*(.07+i%7*.011);
    }
    return p;
  }
}
