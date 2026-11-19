import { WindSolver } from './solver.js';
let solver,paused=false,timer=0,batch=0,reset=0;
function send(){const field=solver.snapshot();self.postMessage({type:'field',...field},[field.data.buffer]);}
self.onmessage=({data})=>{
  if(!data||typeof data!=='object')return;
  if(data.type==='start'&&!solver){
    solver=new WindSolver();solver.setConfig(data.config);reset=data.config?.reset||0;paused=!!data.config?.paused;
    // Small deterministic warmup; subsequent steps are continuous.
    solver.reset();solver.step(82);send();
    timer=setInterval(()=>{if(paused||!solver)return;solver.step(3);if((batch++%2)===0)send();},31);
  }else if(data.type==='configure'&&solver){
    solver.setConfig(data.config);paused=!!data.config?.paused;
    if(data.config?.reset!==reset){reset=data.config?.reset;solver.reset();solver.step(58);send();}
  }else if(data.type==='stop'&&timer){clearInterval(timer);timer=0;solver=null;}
};
