import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleScene, EXAMPLES, demoAnswer, quickDrawing } from '../src/engine/examples.js';
import { sceneFromText, validateScene } from '../src/engine/schema.js';
import { difference } from '../src/engine/trace.js';

for(const {id,name} of EXAMPLES) for(const mode of ['2d','3d']) {
  test(`${name}, ${mode} can round-trip from a scene export`,()=>{
    const item=exampleScene(id,mode);
    const restored=sceneFromText(JSON.stringify(item),{presets:true});
    assert.equal(restored.title,item.title);assert.equal(restored.items.length,item.items.length);assert.equal(restored.labels.length,item.labels.length);
  });
}
test('validation restricts the shape grammar, numbers, fills and unknown fields',()=>{
  const value=validateScene({mode:'3d',title:'  My diagram  ',items:[{type:'not-a-shape',p:[0,0,0]},{type:'box',p:[NaN,128,-60],s:[0,-4,99],color:'url(example)',script:'ignored'}],labels:[{text:'One',at:[1,2,3],anchor:[-1,1],click:'ignored'}]});
  assert.equal(value.title,'My diagram');assert.deepEqual(value.items,[{type:'box',p:[0,32,-32],color:'#468776',s:[.025,.025,24]}]);
  assert.deepEqual(value.labels,[{text:'One',at:[1,2,3],anchor:[.08,.92]}]);
  assert.throws(()=>validateScene({mode:'3d',items:[{type:'pcb'}]}),/supported/);
  assert.throws(()=>validateScene({mode:'2d',items:[]},{mode:'3d'}),/Expected a 3D scene/);
});
test('frame comparison skips stable or nearly identical inputs',()=>{
  assert.equal(difference(null, new Uint8Array([5,5,5,255])),1);
  const black=new Uint8Array([0,0,0,255,0,0,0,255]), lightNoise=new Uint8Array([6,1,12,255,0,0,0,255]), change=new Uint8Array([100,70,60,255,0,0,0,255]);
  assert.equal(difference(black,lightNoise),0);
  assert.equal(difference(black,change),.5);
});
test('local prompts draw defined shapes and flows; unsupported prompts are not guessed',()=>{
  assert.equal(quickDrawing('Draw a blue cube','3d').items[0].type,'box');
  assert.equal(quickDrawing('Draw a flowchart: Read -> Interpret -> Render','2d').items.filter(e=>e.type==='arrow').length,2);
  assert.equal(quickDrawing('Explain international settlement','3d'),null);
  assert.equal(demoAnswer('Show a camera ribbon cable connection','pi','3d').scene.view,'camera');
});
