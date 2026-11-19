import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GRID, WIND_DEFAULT, WindSolver, sampleVector } from '../src/engine/aero/solver.js';
import { aeroScene, labKind } from '../src/engine/aero/scenes.js';
import { FlowParticles, makeTraces, colorize } from '../src/engine/aero/visual-flow.js';
import { compilePlan, editorialExample, FILTER_PLAN } from '../src/engine/compile.js';
import { sceneFromText } from '../src/engine/schema.js';

function solved(config={},withBody=true,count=320){
  const solver=new WindSolver({withBody});solver.setConfig({...WIND_DEFAULT,gust:false,...config});solver.reset();solver.step(count);return solver.snapshot();
}

test('computed flow is finite, slows at the fixed mask, and reports zero net drag without the obstacle',()=>{
  const free=solved({},false), obstructed=solved(), {nx,ny,data}=obstructed;
  assert.equal(free.drag,0);
  assert.ok(obstructed.drag>.30);
  assert.equal(data.length,nx*ny*4);
  assert.ok(obstructed.density>.94&&obstructed.density<1.06);
  assert.ok(data.every(Number.isFinite));
  const m=4*(Math.round(nx*.49)+Math.round(ny*.5)*nx);
  assert.equal(data[m+3],1);
  assert.equal(data[m],0);assert.equal(data[m+1],0);
  const wake=4*(Math.round(nx*.76)+Math.round(ny*.5)*nx);
  assert.ok(data[wake]<free.data[wake]*.85,'wake speed is lower than empty-field speed downstream');
});

test('higher inflow changes momentum exchange and a crosswind flips the sign of upstream lateral velocity',()=>{
  const low=solved({speed:34,cross:-13}), high=solved({speed:85,cross:13});
  const a=[0,0,0],b=[0,0,0];
  sampleVector(low,3,low.ny/2,a);sampleVector(high,3,high.ny/2,b);
  assert.ok(a[1]<-.003&&b[1]>.005);
  assert.ok(high.drag>low.drag+.40);
  const s=new WindSolver();s.setConfig({speed:9999,cross:-9999});
  assert.equal(s.config.speed,100);assert.equal(s.config.cross,-15);
  s.reset();s.step(1);assert.equal(s.snapshot().tick,1);
});

test('the two renderings use a finite traced velocity field and passive markers obey pause and reset',()=>{
  const field=solved({cross:9}), traces=makeTraces(field);
  assert.ok(traces.length>16);
  const p=[0,0,0];
  for(const path of traces)for(const [x,y,wx,wz,mag] of path.points){
    assert.ok(Number.isFinite(wx)&&Number.isFinite(wz)&&mag>0);
    assert.equal(sampleVector(field,x,y,p)[2],0);
  }
  const bank=new FlowParticles(72),start=Array.from(bank.move(field));
  assert.notDeepEqual(Array.from(bank.move(field,.03)),start);
  const stopped=Array.from(bank.move(field));
  assert.deepEqual(Array.from(bank.move(field,0)),stopped);
  assert.deepEqual(Array.from(bank.move({...field,tick:1},0)),start);
  for(const layer of ['speed','wake','lines']){
    const pixels=colorize(field,layer,new Uint8Array(GRID.nx*GRID.ny*4));
    assert.equal(pixels.some((v,i)=>i%4===3&&v>0),layer!=='lines');
  }
});

test('airflow exhibits are fixed and restore their real controls in either renderer',()=>{
  for(const kind of ['wind','engine'])for(const mode of ['2d','3d']){
    const exhibit=aeroScene(kind,mode), imported=sceneFromText(JSON.stringify({...exhibit,solver:{customGeometry:true}}),{presets:true});
    assert.deepEqual(imported,exhibit);
    assert.equal(labKind(imported),kind);
    assert.equal(exhibit.labels.length,kind==='engine'?6:3);
    assert.ok(exhibit.story.steps.every(s=>exhibit.labels[s.focus]));
  }
});

test('guide destinations are numeric and bounded; textual plans receive renderer-owned destinations',()=>{
  const diagrams=[compilePlan(FILTER_PLAN,'2d'),editorialExample('tokens','2d'),editorialExample('pi','2d','camera'),editorialExample('fan','2d')];
  for(const d of diagrams)assert.ok(d.story.steps.every(s=>s.point.length===2&&s.point[0]>=0&&s.point[0]<=1000));
  const plan=diagrams[0], steps=[{title:'Point',point:[2000,-3000]}, {title:'Invalid',point:['42',52]}, {title:'Wrong dimensions',point:[4,8,2]}];
  const round=sceneFromText(JSON.stringify({...plan,story:{steps}}),{presets:true});
  assert.deepEqual(round.story.steps[0].point,[1400,-500]);
  assert.equal(round.story.steps[1].point,undefined);assert.equal(round.story.steps[2].point,undefined);
});
