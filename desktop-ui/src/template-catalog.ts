/// <reference types="vite/client" />
// One catalog for every built-in design: the classic packs, the sports pack and the
// expanded collections prepared by scripts/prepare-template-artwork.mjs.
import {bundledArtwork} from './bundled-artwork/catalog';
import {expandedManifest} from './bundled-artwork/expanded-manifest';

export type Complexity='Simple'|'Moderate'|'Detailed';
export type TemplateEntry={
 id:string;name:string;file:string;svg:string;
 /** Library category shown in the sidebar. */
 group:string;
 collection:string;tags:string[];colors:number;complexity:Complexity;
 /** Traced artwork that still needs a careful review before production. */
 draft:boolean;
};

// Vite inlines the expanded SVG files at build time. Outside Vite (unit tests run by
// Node) the expanded files are simply absent; their metadata is still available.
const expandedFiles:Record<string,string>=import.meta.env
 ?import.meta.glob<string>('./bundled-artwork/expanded/**/*.svg',{eager:true,query:'?raw',import:'default'})
 :{};

const legacyGroups:Record<string,[string,string[]]>={
 '01_Bows':['Boutique & bows',[]],'02_Sports':['Sports',[]],'03_Animals':['Animals',[]],'04_Faith':['Faith',[]],
 '05_Floral':['Floral & botanical',[]],'06_Blank_Name_Templates':['Monograms & frames',['Personalize']],'07_Seasonal':['Seasonal',[]],
 '08_Western_Farm':['Western & farm',[]],'09_Baby':['Baby & children',[]],'10_Applique':['Appliqué',[]],
 '11_Boutique_Nameplates':['Monograms & frames',['Boutique','Personalize']],'12_Team_Nameplates':['Sports',['Nameplate','Personalize']],
 '13_Faith_Frames':['Faith',['Frame','Personalize']],'14_Nursery_Nameplates':['Baby & children',['Nameplate','Personalize']],
 '15_Seasonal_Nameplates':['Seasonal',['Nameplate','Personalize']],'16_Western_Farm':['Western & farm',['Nameplate','Personalize']],
 '17_Botanical_Frames':['Floral & botanical',['Frame','Personalize']],'18_Ocean_Adventure':['Beach & ocean',[]],
 '19_School_Hobbies':['School & hobbies',[]],'20_Applique_Badges':['Appliqué',['Badge']],
};

/** Preferred sidebar order; any other category follows alphabetically. */
export const categoryOrder=['Sayings','Monograms & frames','Boutique & bows','Baby & children','Sports','Faith','Floral & botanical','Seasonal',
 'Western & farm','Outdoors & hunting','Fishing','Beach & ocean','Animals','School & hobbies','Vehicles & construction','Birthday & celebrations',
 'Everyday & lifestyle','Mini & left chest','Appliqué'];

const title=(id:string)=>id.replace(/^\d+[-_]/,'').replace(/[-_]+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
function svgStats(svg:string):{colors:number;complexity:Complexity}{
 const colors=new Set((svg.match(/(?:fill|stroke)\s*[=:]\s*"?(#[0-9a-fA-F]{3,8})/g)??[]).map(v=>v.replace(/.*#/,'').toLowerCase()).filter(c=>c!=='fff'&&c!=='ffffff'));
 const commands=(svg.match(/\sd="[^"]*"/g)??[]).reduce((n,d)=>n+(d.match(/[A-Za-z]/g)?.length??0),0);
 const shapes=(svg.match(/<(path|circle|ellipse|rect|polygon|polyline|line)\b/g)??[]).length;
 return {colors:Math.max(1,colors.size),complexity:commands>2500||shapes>40?'Detailed':commands>500||shapes>12?'Moderate':'Simple'};
}

function legacy(a:{category:string;id:string;svg:string},collection:string):TemplateEntry{
 let group:string,tags:string[];
 const sport=a.category.match(/^Sports( appliqué)? \/ (.+)$/);
 if(sport){group=sport[1]?'Appliqué':'Sports';tags=sport[1]?['Sports',sport[2]]:[sport[2]]}
 else [group,tags]=legacyGroups[a.category]??[a.category,[]];
 return {id:a.id,name:title(a.id),file:a.id+'.svg',svg:a.svg,group,collection,tags,draft:false,...svgStats(a.svg)};
}

export const templateCatalog:TemplateEntry[]=[
 ...bundledArtwork.map(a=>legacy(a,'Classic collection')).filter(a=>a.complexity!=='Simple'||a.group==='Mini & left chest'),
 // Repetitive generated sports badges are archived until individually redesigned.

 ...expandedManifest.flatMap(m=>{
  // Archive unreviewed traced artwork and rejected redraws; never expose them as production templates.
  if(m.collection==='Curated heirloom'||m.draft)return [];
  const svg=expandedFiles['./bundled-artwork/expanded/'+m.path];
  if(import.meta.env&&svg===undefined)return [];
  return [{id:m.id,name:m.name,file:m.id+'.svg',svg:svg??'',group:m.category,collection:m.collection,tags:m.tags,colors:m.colors,complexity:m.complexity,draft:m.draft}];
 }),
];

export function sortCategories(names:string[]){
 const rank=(n:string)=>{const i=categoryOrder.indexOf(n);return i<0?categoryOrder.length:i};
 return [...names].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));
}
