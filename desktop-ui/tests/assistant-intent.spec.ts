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
