// Original civilian teaching shape. Coordinates are drawing units, not aircraft data.
export const DOMAIN={minX:-8.55,maxX:9.8,minZ:-6.65,maxZ:6.65};
export const BODY=[[-4.95,.035],[-4.82,.23],[-4.54,.44],[-4.15,.58],[-3.65,.65],[-3.05,.68],[-2.3,.69],[1.79,.69],[2.54,.60],[3.22,.46],[3.87,.29],[4.38,.13],[4.62,.03]];
export const WING=[[-1.58,.49],[-.87,1.39],[.62,3.58],[.90,3.72],[1.30,3.62],[1.65,.55]];
export const TAIL=[[2.66,.26],[3.08,.72],[3.63,1.45],[4.06,1.46],[4.24,.28]];
export const POD={x:-.28,z:1.49,r:.34,length:1.48};
export function bodyRadius(x){
  for(let i=1;i<BODY.length;i++)if(x>=BODY[i-1][0]&&x<=BODY[i][0]){const [a,r]=BODY[i-1], [b,s]=BODY[i];return r+(s-r)*(x-a)/(b-a);}
  return 0;
}
export function insidePolygon(x,z,polygon){
  let inside=false;
  for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const [a,b]=polygon[i],[c,d]=polygon[j];
    if((b>z)!==(d>z) && x<(c-a)*(z-b)/(d-b)+a)inside=!inside;
  }return inside;
}
export function silhouetteContains(x,z){
  z=Math.abs(z);
  if(z<bodyRadius(x)||insidePolygon(x,z,WING)||insidePolygon(x,z,TAIL))return true;
  const lx=Math.abs(x-POD.x),q=Math.abs(z-POD.z);
  return lx<POD.length*.49&&q<POD.r*(lx<POD.length*.35?1:.86);
}
export function makeMask(nx,ny,withBody=true){
  const grid=new Uint8Array(nx*ny);
  if(!withBody)return grid;
  for(let y=0;y<ny;y++)for(let x=0;x<nx;x++){
    const wx=DOMAIN.minX+(DOMAIN.maxX-DOMAIN.minX)*x/(nx-1),wz=DOMAIN.minZ+(DOMAIN.maxZ-DOMAIN.minZ)*y/(ny-1);
    grid[x+nx*y]=Number(silhouetteContains(wx,wz));
  }
  return grid;
}
export function worldAt(x,y,nx,ny){return [DOMAIN.minX+(DOMAIN.maxX-DOMAIN.minX)*x/(nx-1),DOMAIN.minZ+(DOMAIN.maxZ-DOMAIN.minZ)*y/(ny-1)];}
