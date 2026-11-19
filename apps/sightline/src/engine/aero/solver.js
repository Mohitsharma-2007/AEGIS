import { makeMask } from './airframe.js';

const Cx=[0,1,0,-1,0,1,-1,-1,1], Cy=[0,0,1,0,-1,1,1,-1,-1];
const reverse=[0,3,4,1,2,7,8,5,6];
const weight=[4/9,1/9,1/9,1/9,1/9,1/36,1/36,1/36,1/36];
const clamp=(x,a,b)=>Math.max(a,Math.min(x,b));
export const GRID={nx:148,ny:72};
export const WIND_DEFAULT={speed:61,cross:0,gust:true,paused:false,layer:'speed',reset:0};
// Low-speed educational D2Q9/BGK lattice-Boltzmann solver. Lattice units only.
// Link bounce-back models a fixed obstacle and transfers momentum to it.
export class WindSolver {
  constructor({nx=GRID.nx,ny=GRID.ny,withBody=true}={}){
    this.nx=nx;this.ny=ny;this.n=nx*ny;this.mask=makeMask(nx,ny,withBody);
    this.f=new Float32Array(this.n*9);this.post=new Float32Array(this.n*9);
    this.dest=new Int32Array(this.n*9);
    this.links=new Uint8Array(this.n*9);
    let frontal=0;
    for(let y=0;y<ny;y++){
      let hasBody=false;
      for(let x=0;x<nx;x++){
        const p=x+y*nx;if(this.mask[p])hasBody=true;
        for(let k=0;k<9;k++){
          const xx=x+Cx[k],yy=(y+Cy[k]+ny)%ny,ix=k*this.n+p;
          const bounce=xx>=0&&xx<nx&&this.mask[xx+nx*yy];
          if(bounce){this.dest[ix]=reverse[k]*this.n+p;this.links[ix]=1;}
          else if(xx<0||xx>=nx){this.dest[ix]=p+k*this.n;this.links[ix]=2;}
          else this.dest[ix]=xx+nx*yy+k*this.n;
        }
      }if(hasBody)frontal++;
    }
    this.frontal=frontal;this.ux=new Float32Array(this.n);this.uy=new Float32Array(this.n);this.rho=new Float32Array(this.n);
    this.config={...WIND_DEFAULT};this.reset();
  }
  setConfig(cfg={}){
    this.config={...this.config,...cfg,speed:clamp(Number.isFinite(+cfg.speed)?+cfg.speed:this.config.speed,12,100),cross:clamp(Number.isFinite(+cfg.cross)?+cfg.cross:this.config.cross,-15,15)};
  }
  inlet(t=this.t){
    const s=.026+this.config.speed*.00050;
    const angle=this.config.cross*Math.PI/180;
    return [s*Math.cos(angle)+(this.config.gust?.0037*Math.sin(t*.035):0),s*Math.sin(angle)+(this.config.gust?.0044*Math.sin(t*.027+.7):0)];
  }
  reset(){
    this.t=0;this.drag=0;this.side=0;this.mass=1;this.peak=0;
    const [u,v]=this.inlet(0);
    const u2=1.5*(u*u+v*v);
    for(let k=0;k<9;k++){const d=3*(Cx[k]*u+Cy[k]*v);this.f.fill(weight[k]*(1+d+.5*d*d-u2),k*this.n,(k+1)*this.n);}
    this.post.set(this.f);
  }
  step(count=1){for(let i=0;i<count;i++)this.advance();}
  advance(){
    const {n,nx,ny,f,post,mask,links,dest}=this;
    let fx=0,fy=0;const omega=1/.705;
    const [inputX,inputY]=this.inlet();
    // Stream after collision. Two excluded x boundaries are filled below.
    for(let p=0;p<n;p++){
      if(mask[p])continue;
      const f0=f[p],f1=f[p+n],f2=f[p+2*n],f3=f[p+3*n],f4=f[p+4*n],f5=f[p+5*n],f6=f[p+6*n],f7=f[p+7*n],f8=f[p+8*n];
      const rho=f0+f1+f2+f3+f4+f5+f6+f7+f8;
      const keep=rho>0.45&&rho<1.75;
      const inv=keep?1/rho:0;
      const u=keep?clamp((f1-f3+f5-f6-f7+f8)*inv,-.27,.27):inputX;
      const v=keep?clamp((f2-f4+f5+f6-f7-f8)*inv,-.27,.27):inputY;
      const q=1-1.5*(u*u+v*v),r=keep?rho:1;
      for(let k=0;k<9;k++){
        const from=p+k*n,l=links[from];
        if(l===2)continue;
        const dot=3*(Cx[k]*u+Cy[k]*v), eq=r*weight[k]*(q+dot+.5*dot*dot);
        const after=keep?f[from]+omega*(eq-f[from]):eq;
        post[dest[from]]=after;
        if(l){fx+=2*after*Cx[k];fy+=2*after*Cy[k];}
      }
    }
    // Prescribed inlet; open downstream approximation. Lateral boundaries are periodic.
    const q=1-1.5*(inputX*inputX+inputY*inputY);
    for(let y=0;y<ny;y++){
      const a=y*nx,b=a+nx-1;
      const gust=this.config.gust?.002*Math.sin(y*.19+this.t*.023):0;
      for(let k=0;k<9;k++){
        const d=3*(Cx[k]*inputX+Cy[k]*(inputY+gust)), offset=k*n;
        const eq=weight[k]*(q+d+.5*d*d);
        post[a+offset]=eq;
        post[b+offset]=.95*post[b-1+offset]+.05*eq;
      }
    }
    this.f=post;this.post=f;this.t++;
    const mag=Math.hypot(inputX,inputY), resistance=(fx*inputX+fy*inputY)/Math.max(.001,mag);
    // Display this as a bounded, unitless classroom index, not a drag coefficient.
    const d=clamp(resistance/Math.max(.012,(.07*.07)*this.frontal*1.22),0,12);
    this.drag+=(this.frontal?d-this.drag:-this.drag)*.043;
    this.side+=(fy-this.side)*.043;
  }
  snapshot(){
    const {f,n,nx,ny,mask}=this, [inX,inY]=this.inlet();
    const ux=this.ux,uy=this.uy,rho=this.rho;let total=0,peak=0,flow=0;
    for(let p=0;p<n;p++){
      if(mask[p]){ux[p]=0;uy[p]=0;rho[p]=1;continue;}
      const a=f[p+n],b=f[p+2*n],c=f[p+3*n],d=f[p+4*n],e=f[p+5*n],g=f[p+6*n],h=f[p+7*n],i=f[p+8*n];
      const density=f[p]+a+b+c+d+e+g+h+i;
      if(!(density>0.25&&density<2)){ux[p]=inX;uy[p]=inY;rho[p]=1;total++;flow++;continue;}
      rho[p]=density;ux[p]=(a-c+e-g-h+i)/density;uy[p]=(b-d+e+g-h-i)/density;
      total+=density;flow++;
      if((p%nx)>3&&(p%nx)<nx-3)peak=Math.max(peak,Math.hypot(ux[p],uy[p]));
    }
    const data=new Float32Array(n*4);
    for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
      const p=x+y*nx,i=p*4;
      const a=(y+1)%ny*nx+x,b=(y+ny-1)%ny*nx+x;
      data[i]=ux[p];data[i+1]=uy[p];data[i+2]=mask[p]?0:.5*(uy[Math.min(nx-1,x+1)+y*nx]-uy[Math.max(0,x-1)+y*nx]-(ux[a]-ux[b]));data[i+3]=mask[p];
    }
    return {data,nx,ny,tick:this.t,drag:this.drag,side:this.side,density:total/Math.max(1,flow),peak,inlet:Math.hypot(inX,inY)};
  }
}

export function sampleVector(field,x,y,out){
  const {nx,ny,data}=field;
  if(x<0||y<0||x>=nx-1||y>=ny-1){out[0]=0;out[1]=0;out[2]=1;return out;}
  const X=x|0,Y=y|0,ax=x-X,ay=y-Y,p=4*(X+Y*nx),q=p+4*nx;
  const nearest=4*(Math.round(x)+Math.round(y)*nx);
  out[0]=(1-ay)*((1-ax)*data[p]+ax*data[p+4])+ay*((1-ax)*data[q]+ax*data[q+4]);
  out[1]=(1-ay)*((1-ax)*data[p+1]+ax*data[p+5])+ay*((1-ax)*data[q+1]+ax*data[q+5]);
  out[2]=data[nearest+3];return out;
}
