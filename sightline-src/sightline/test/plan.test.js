import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, knownPlan, validatePlan } from '../src/engine/plan.js';
import { compilePlan, editorialExample, FILTER_PLAN } from '../src/engine/compile.js';
import { sceneFromText } from '../src/engine/schema.js';

const glyphs=['block','chip','board','ring','tube','sphere','panel','flow','pin','screen'];
for(const mode of ['2d','3d'])for(const kind of ['process','anatomy','assembly','comparison','cycle','forces','hierarchy'])test(`${mode} ${kind} assembles bounded and round-trippable geometry`,()=>{
  const model={kind,title:'New subject',summary:'Compare the role of each part.',parts:glyphs.map((form,i)=>({name:`Part ${i}`,note:'A readable description of what takes place in the process.',form})),asset:'none'};
  const scene=compilePlan(model,mode), round=sceneFromText(JSON.stringify(scene),{presets:true});
  assert.equal(scene.items.length,round.items.length);assert.ok(scene.items.length<=160);assert.equal(scene.story.steps.length,5);assert.deepEqual(scene.story.steps,round.story.steps);assert.equal(scene.quality,'schematic');
  if(mode==='3d')assert.equal(round.items.filter(x=>x.type==='tile').length,5);
});

test('a small model can use one-line JSON, fences, aliases, tuples, or separate thinking markup',()=>{
  const simple='{"type":"flowchart","subject":"Pipe flow","steps":[["Inlet","Water enters {here}","cylinder"],"Outlet"],"asset":"none"}';
  const plan=parsePlan('<think>Separate model reasoning.</think>\n```json\n'+simple+'\n```');
  assert.equal(plan.kind,'process');assert.equal(plan.parts[0].form,'tube');assert.equal(plan.parts[0].note,'Water enters {here}');
  assert.equal(plan.parts[1].name,'Outlet');
});

test('renderer-managed styles and geometry are invariant for equivalent plans',()=>{
  const local=parsePlan(JSON.stringify({...FILTER_PLAN,colors:['red'],parts:FILTER_PLAN.parts.map(p=>({...p,r:[45,0,0],color:'#ff0000'}))}));
  const cloud=parsePlan('```json\n'+JSON.stringify(FILTER_PLAN)+'\n```');
  assert.deepEqual(compilePlan(local,'2d'),compilePlan(cloud,'2d'));
  assert.deepEqual(compilePlan(local,'3d'),compilePlan(cloud,'3d'));
  const asset=knownPlan('Show how a camera attaches to a Raspberry Pi 5.');
  assert.equal(asset.asset,'pi_camera');assert.deepEqual(compilePlan(asset,'3d'),editorialExample('pi','3d','camera'));
});

test('unclear is explicit, and unsupported nested fields cannot become renderer objects',()=>{
  assert.equal(validatePlan({kind:'unclear',parts:[],executables:['ignored']}).kind,'unclear');
  const plan=validatePlan({kind:'constructor',title:'Subject',parts:[{name:'Step',form:'constructor',url:'ignored'}]});
  assert.equal(plan.kind,'process');assert.equal(plan.parts[0].form,'block');assert.equal(plan.parts[0].url,undefined);
  assert.throws(()=>parsePlan('Not valid {{no recipe}}'),/usable/);
});
