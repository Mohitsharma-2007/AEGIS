// The guide follows diagram coordinates. It never moves the visitor's real cursor.
const cut=(n,a,b)=>Math.max(a,Math.min(n,b));
const xy=(x,y)=>`translate(${x.toFixed(2)} ${y.toFixed(2)})`;
const ease=t=>1-(1-t)**3;
const wobble=(d,t)=>Math.min(28,d*.12)*Math.sin(Math.PI*t);

export function guidePosition(from,to,elapsed,reduced=false){
  const t=reduced?1:cut(elapsed/620,0,1),p=ease(t);
  return [from[0]+(to[0]-from[0])*p,from[1]+(to[1]-from[1])*p-wobble(Math.hypot(to[0]-from[0],to[1]-from[1]),t),t];
}

export function projectGuide(host,ref,cue,project,viewport){
  const nodes=ref.current, root=nodes.layer, mark=nodes.mark, pointer=nodes.pointer;
  if(!root||!mark||!pointer)return;
  const w=host.clientWidth,h=host.clientHeight,pt=cue&&w>0&&h>0?project(cue.at,w,h,cue.label):null;
  const good=pt?.[2]&&pt[0]>=5&&pt[0]<=w-5&&pt[1]>=5&&pt[1]<=h-5&&(!viewport||viewport(pt,w,h));
  let st=nodes.motion;
  if(!good){
    if(st?.raf){st.win.cancelAnimationFrame(st.raf);st.raf=0;}
    if(st)st.visible=false;
    if(root.dataset.guideActive==='true')root.dataset.guideActive='false';
    return;
  }
  const [x,y]=pt, size=w<480?.78:w<650?.90:1, direction=x>w-96?-1:1, up=y>h-49;
  if(!st){st=nodes.motion={visible:false,win:host.ownerDocument.defaultView||window,raf:0,x:NaN,y:NaN,id:null,signature:''};}
  const brandNew=st.scene!==cue.scene;
  const newAim=st.id!==cue.id||!st.visible||brandNew;
  st.scene=cue.scene;
  st.target=[x,y];st.size=size;st.direction=direction;st.up=up;
  if(newAim){
    st.visible=true;st.id=cue.id;st.begin=st.win.performance.now();
    st.from=(!brandNew&&Number.isFinite(st.x))?[cut(st.x,8,w-8),cut(st.y,8,h-8)]:[cut(x+(x>w/2?-1:1)*Math.min(w*.21,104),12,w-12),cut(y+49,13,h-16)];
    st.reduced=st.win.matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.dataset.guideActive='true';
    nodes.stroke?.getAnimations?.().forEach(a=>a.cancel());
    if(!st.reduced)nodes.stroke?.animate?.([{strokeDashoffset:'1'},{strokeDashoffset:'0'}],{duration:520,delay:110,easing:'cubic-bezier(.2,.66,.36,1)',fill:'backwards'});
  }
  const key=`${x.toFixed(2)}|${y.toFixed(2)}|${size}`;
  if(st.signature!==key){mark.setAttribute('transform',`${xy(x,y)} scale(${size})`);st.signature=key;}
  function paint(now){
    st.raf=0;if(!st.visible||!nodes.layer)return;
    const [nowX,nowY,t]=guidePosition(st.from,st.target,now-st.begin,st.reduced);
    st.x=nowX;st.y=nowY;
    pointer.setAttribute('transform',`${xy(nowX,nowY)} scale(${st.size})`);
    nodes.tip?.setAttribute('transform',`${st.direction<0?'scale(-1 1) ':''}${st.up?'scale(1 -1)':''}`.trim());
    nodes.tag?.setAttribute('transform',`translate(${st.direction<0?-74:13} ${st.up?-32:19})`);
    nodes.trail?.setAttribute('d',t===1?'':`M ${st.from[0]} ${st.from[1]} Q ${(st.from[0]+nowX)/2} ${Math.min(st.from[1],nowY)-11} ${nowX} ${nowY}`);
    if(t<1)st.raf=st.win.requestAnimationFrame(paint);
  }
  if(!st.raf&&(newAim||!Number.isFinite(st.x)||Math.abs(st.x-x)+Math.abs(st.y-y)>.06))paint(st.win.performance.now());
}

export function GuideLayer({motion}){
  const ref=key=>el=>{motion.current[key]=el;};
  return <svg className="guide-layer" aria-hidden="true" focusable="false" ref={ref('layer')}>
    <path className="guide-trail" ref={ref('trail')}/>
    <g className="guide-mark" ref={ref('mark')}>
      <ellipse rx="29" ry="22" transform="rotate(-13)" className="guide-fill"/>
      <path d="M-22 13C-34 4-28-13-11-20 6-27 28-20 29-5 30 10 14 23-3 22-12 22-22 19-26 14" className="guide-outline"/>
      <path d="M-23 16C-33 8-29-9-15-17 3-27 23-22 28-8 33 5 18 18 5 21-9 24-22 19-25 15" pathLength="1" className="guide-ink" ref={ref('stroke')}/>
      <path d="M-4 0H4M0-4V4" className="guide-reticle"/>
    </g>
    <g className="guide-cursor" ref={ref('pointer')}>
      <path d="M0 0 4.7 21 9.2 13.7 17.6 11.8 Z" className="guide-tip" ref={ref('tip')}/>
      <g className="guide-chip" ref={ref('tag')}><rect width="61" height="18" rx="5"/><circle cx="9" cy="9" r="2"/><text x="17" y="12.4">GUIDE</text></g>
    </g>
  </svg>;
}
