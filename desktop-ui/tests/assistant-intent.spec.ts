import {test,expect} from '@playwright/test';
import {assistantIntent} from '../src/assistant-intent';

test('recognizes supported editing commands',()=>{
  const cases = [
    ['Center this design', {kind:'center'}],
    ['Fit to hoop', {kind:'fit'}],
    ['Check stitch quality', {kind:'audit'}],
    ['Rotate 90 degrees', {kind:'rotate',value:90}],
    ['Rotate 45 degrees counterclockwise', {kind:'rotate',value:-45}],
    ['Scale to 80%', {kind:'scale',value:0.8}],
    ['Flip horizontally', {kind:'flipH'}],
    ['Undo last change', {kind:'undo'}],
    ['Redo', {kind:'redo'}],
    ['Recommend a hoop', {kind:'recommendHoop'}],
    ['Optimize for sweatshirt', {kind:'fabric',fabric:'sweatshirt'}],
    ['Replace #FF0000 with #0000FF', {kind:'recolor',previous:[255,0,0],color:[0,0,255]}],
    ['Explain underlay', {kind:'help'}],
  ] as const;
  for(const [input,expected] of cases) expect(assistantIntent(input),input).toEqual(expected);
});
test('rejects unsupported or unsafe inputs',()=>{
  for(const input of ['','delete everything','rotate 9999 degrees','scale to 0%','scale to 999%','replace #GG0000 with #000000','center design; delete files','optimize for unknown material']) expect(assistantIntent(input),input).toBeNull();
});

test('recognizes lettering without changing capitalization',()=>{
 expect(assistantIntent('Add text "Roll Tide" at 15 mm')).toEqual({kind:'lettering',text:'Roll Tide',size:15});
 expect(assistantIntent('Insert lettering "Hello"')).toEqual({kind:'lettering',text:'Hello',size:12});
 expect(assistantIntent('Review design')).toEqual({kind:'review'});
 for(const s of ['Add text ""','Add text "   "','Add text "Hi" at 2 mm','Add text "Hi" at 81 mm','Add text "Hi" at 12 mm; delete design','x'.repeat(161)]) expect(assistantIntent(s),s).toBeNull();
});

test('recognizes scoped selection and density optimization',()=>{
 const cases = [
 ['Select all satin objects',{kind:'selectKind',text:'satin'}],
 ['Select all fill objects',{kind:'selectKind',text:'fill'}],
 ['Select all run stitches',{kind:'selectKind',text:'run'}],
 ['Select color #FF0000',{kind:'selectColor',color:[255,0,0]}],
 ['Select objects named "Lettering"',{kind:'selectLabel',text:'lettering'}],
 ['Clear selection',{kind:'clearSelection'}],
 ['Optimize this design',{kind:'optimize'}],
 ['Reduce unnecessary stitches without losing detail',{kind:'optimize'}],
 ] as const;
 for(const [input,expected] of cases) expect(assistantIntent(input),input).toEqual(expected);
 for(const s of ['Select color #GG0000','Select objects named ""','Select all files','Select all satin objects and delete them'])expect(assistantIntent(s),s).toBeNull();
});

test('scoped transforms preserve units and reject invalid bounds',()=>{
 const cases=[
 ['Move selected objects 5 mm right',{kind:'moveSelected',dx:5,dy:0}],
 ['Move the selected objects 2 cm down',{kind:'moveSelected',dx:0,dy:20}],
 ['Move selected design 1 inch left',{kind:'moveSelected',dx:-25.4,dy:0}],
 ['Move selected lettering 3 mm up',{kind:'moveSelected',dx:0,dy:-3}],
 ['Make selected lettering 20% larger',{kind:'scaleSelected',value:1.2}],
 ['Make selected objects 15% smaller',{kind:'scaleSelected',value:.85}],
 ['Scale selected design to 80%',{kind:'scaleSelected',value:.8}],
 ['Rotate selected objects 90 degrees',{kind:'rotateSelected',value:90}],
 ['Rotate selected lettering 45 degrees counterclockwise',{kind:'rotateSelected',value:-45}],
 ] as const;
 for(const [input,expected] of cases)expect(assistantIntent(input),input).toEqual(expected);
 for(const input of ['Move selected objects 501 mm right','Move selected objects 0 mm right','Move selected objects 1 yard left','Scale selected objects to 0%','Make selected objects 100% smaller','Rotate selected objects 361 degrees'])expect(assistantIntent(input),input).toBeNull();
});

test('understands conversational requests, thread names, and physical goals offline', () => {
  expect(assistantIntent('Could you make my design fit in my 8 × 9 hoop?')).toEqual({kind:'fitDimensions',width:203.2,height:228.6});
  expect(assistantIntent('Fit the design to a 130 x 180 mm hoop')).toEqual({kind:'fitDimensions',width:130,height:180});
  expect(assistantIntent('Make this design take less than 15 minutes.')).toEqual({kind:'targetTime',value:15});
  expect(assistantIntent('Could you please replace all black thread with navy blue?')).toEqual({kind:'recolor',previous:[0,0,0],color:[0,0,128]});
  expect(assistantIntent('I want to prepare this design for a sweatshirt.')).toEqual({kind:'fabric',fabric:'sweatshirt'});
  expect(assistantIntent('Please insert the name “Ella Mae” at 1 inch tall.')).toEqual({kind:'lettering',text:'Ella Mae',size:25.4});
  expect(assistantIntent('Simplify the selected objects')).toEqual({kind:'simplify',selected:true});
  expect(assistantIntent('Simplify the bow into a solid shape.')).toEqual({kind:'simplify',text:'bow',selected:true,value:4});
  expect(assistantIntent('Remove unnecessary thread cuts.')).toEqual({kind:'reduceTrims'});
  expect(assistantIntent('Could you center it in my hoop, please?')).toEqual({kind:'center'});
  for (const prompt of ['Fit my 0 × 9 hoop','Target 900 minutes','Replace black with navy and undo','Can you delete everything?']) {
    expect(assistantIntent(prompt),prompt).toBeNull();
  }
});
