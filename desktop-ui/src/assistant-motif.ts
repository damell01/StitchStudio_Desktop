import {invoke} from '@tauri-apps/api/core';
import {builtins, type ArtworkEntry} from './character-gallery';

const generic = new Map([
  ['bow','004_lavender-ribbon'], ['ribbon bow','004_lavender-ribbon'],
  ['heart','080_valentine-heart'], ['star','097_classic-star'],
  ['flower','057_sunflower'], ['circle','circle'], ['square','square'],
  ['rectangle','rectangle'], ['rounded square','rounded square'], ['triangle','triangle'],
  ['oval','oval'], ['diamond','diamond'], ['shield','shield'],
]);

const basicShapes = new Map([
  ['circle','M50 4 A46 46 0 1 1 49.99 4 Z'],
  ['square','M5 5 H95 V95 H5 Z'],
  ['rectangle','M5 20 H95 V80 H5 Z'],
  ['rounded square','M17 5 H83 Q95 5 95 17 V83 Q95 95 83 95 H17 Q5 95 5 83 V17 Q5 5 17 5 Z'],
  ['triangle','M50 4 L96 92 H4 Z'],
  ['oval','M50 20 A46 30 0 1 1 49.99 20 Z'],
  ['diamond','M50 4 L96 50 L50 96 L4 50 Z'],
  ['shield','M10 10 H90 V48 Q90 75 50 95 Q10 75 10 48 Z'],
]);

const colors = new Map<string, number[]>([
  ['navy blue',[0,0,128]], ['lavender',[145,119,184]], ['pink',[215,90,130]],
  ['red',[185,61,75]], ['blue',[65,124,172]], ['green',[85,132,98]],
  ['yellow',[229,183,63]], ['gold',[205,156,42]], ['black',[28,27,33]],
  ['white',[250,249,245]], ['purple',[105,69,162]], ['navy',[0,0,128]],
  ['teal',[0,128,128]], ['orange',[217,123,57]], ['gray',[128,128,128]],
]);

function key(name: string) {
  return name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
}

function singular(name: string) {
  return name.replace(/\b(bow|heart|star|flower|circle|square|rectangle|triangle|oval|diamond|shield)s\b/g,'$1');
}

function candidates(entries: ArtworkEntry[], name: string) {
  const exact = entries.filter(entry => key(entry.name) === name);
  if (exact.length) return exact;
  return entries.filter(entry => (' '+key(entry.name)+' ').includes(' '+name+' '));
}

function builtin(name: string): ArtworkEntry[] {
  const alias = generic.get(name);
  if (alias) {
    const path = basicShapes.get(alias);
    if (path) return [{name:alias,group:'Basic shapes',file:alias+'.svg',
      svg:`<svg xmlns="http://www.w3.org/2000/svg" width="100mm" height="100mm" viewBox="0 0 100 100"><path d="${path}" fill="#754bb0"/></svg>`}];
    return builtins.filter(entry=>entry.id===alias);
  }
  return candidates(builtins,name);
}

export async function resolveMotif(query: string, width: number): Promise<
  {name: string; svg: string; color?: number[]} | {message: string}
> {
  const name = singular(key(query));
  if (!name) return {message:'Name a shape or a library artwork to add.'};
  const exact = builtins.filter(entry=>key(entry.name)===name);
  const leading = Array.from(colors.keys()).find(color=>name.startsWith(color+' '));
  const bare = leading ? name.slice(leading.length+1) : name;
  let matches = exact.length ? exact : builtin(bare);
  let color = leading && !exact.length ? colors.get(leading) : undefined;
  // Match imported art by its visible library name. An exact built-in or a
  // generic shape is immediately available without scanning the local folder.
  if (!matches.length) {
    const local = await invoke<ArtworkEntry[]>('character_list');
    matches = candidates(local ?? [],name);
    if (!matches.length && bare!==name) matches=candidates(local ?? [],bare);
    if (matches.some(entry=>key(entry.name)===name)) color=undefined;
  }
  if (!matches.length) return {message:`I couldn’t find “${query}” in the artwork library. Import the artwork in Design Library → Artwork, then ask for it by name. You can also try a shape like a bow, star or heart.`};
  if (matches.length > 1) return {message:'Several artworks match. Ask for the full name, such as '+matches.slice(0,4).map(entry=>'“'+entry.name+'”').join(', ')+'.'};
  const item = matches[0];
  const svg = item.svg ?? await invoke<string>('trace_assistant_motif',{group:item.group,file:item.file,width});
  return {name:item.name, svg, color};
}
