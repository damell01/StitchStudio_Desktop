import {compareNames,ListNavigation,matchesName,usePagedList} from './list-navigation';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ArrowRight, Search, Star, X } from 'lucide-react';
import twemojiCatalogue from './twemoji-templates.json';

type Attribution = { credit: string; license: string; licenseUrl: string; sourceUrl: string };
export type Template = { id: string; name: string; category: string; art: string; tags?: string[]; attribution?: Attribution };

const twemojiAssets = import.meta.glob<string>('./assets/twemoji/*.svg', {
  query: '?raw', import: 'default', eager: true,
});
const twemojiTemplates: Template[] = twemojiCatalogue.map(({id,name,category,tags,asset,...attribution}) => ({
  id, name, category, tags, attribution,
  art: twemojiAssets[`./assets/twemoji/${asset}.svg`],
}));

export const templates: Template[] = [
{"id":"boutique-bow-01","name":"Boutique tied ribbon","category":"Bows","tags":["coquette","ribbon","baby","preppy"],"art":"<path fill=\"#d59aa9\" d=\"M46 43 C34 18 9 12 8 32 C5 50 24 58 44 49 L19 84 34 79 48 58 53 58 67 88 79 80 56 49 C76 59 96 48 92 29 C89 12 67 18 54 43Z\"/><path fill=\"#a75d76\" d=\"M44 45 Q25 27 17 33 Q21 45 44 48 M56 45 Q76 27 83 33 Q79 45 56 48\"/><rect x=\"43\" y=\"39\" width=\"14\" height=\"17\" rx=\"5\" fill=\"#bd748c\"/>"},
{"id":"botanical-rose-01","name":"Heirloom rose sprig","category":"Botanical","tags":["floral","vintage","garden","heirloom"],"art":"<path d=\"M48 91 Q55 60 48 30 M51 69 L25 51 M52 58 L76 43\" stroke=\"#507456\" stroke-width=\"3\" fill=\"none\"/><path fill=\"#76946d\" d=\"M48 70 Q18 74 15 44 Q37 42 48 70 M53 60 Q63 35 86 39 Q84 61 53 60\"/><path fill=\"#c77e91\" d=\"M48 9 C26 0 17 22 30 34 C20 50 48 60 58 44 C81 49 88 22 69 16 C64 3 53 3 48 9Z\"/><path fill=\"#e8b3b9\" d=\"M48 16 C31 12 29 30 42 35 C43 48 65 40 64 27 C72 14 55 10 48 16Z\"/><path fill=\"#a95d76\" d=\"M43 25 Q52 17 59 26 Q55 36 46 32Z\"/>"},
{"id":"nursery-duck-01","name":"Nursery duck with bonnet","category":"Baby","tags":["duck","nursery","easter","heirloom"],"art":"<path fill=\"#e7c575\" d=\"M20 63 Q8 54 10 46 L30 51 Q39 43 48 44 Q39 28 49 17 Q64 4 79 19 Q90 36 75 49 Q91 58 85 73 Q75 91 43 88 Q20 85 20 63Z\"/><path fill=\"#d7a85b\" d=\"M34 62 Q53 48 70 61 Q62 79 42 75Z\"/><path fill=\"#cf8753\" d=\"M80 31 L96 37 80 43Z M45 87 L37 95 H58 L55 87 M67 87 L62 95 H81 L75 86Z\"/><path fill=\"#9eb8ca\" d=\"M43 25 Q42 4 65 5 Q84 7 87 25 L79 29 Q67 17 43 25Z\"/><circle cx=\"72\" cy=\"32\" r=\"3\" fill=\"#443a34\"/>"},
{"id":"varsity-pennant-01","name":"Vintage varsity pennant","category":"Sports","tags":["college","team","retro","school"],"art":"<path fill=\"#a34343\" d=\"M18 13 L92 43 18 74Z\"/><path fill=\"#f1dfb6\" d=\"M23 20 L77 43 23 65Z\"/><path fill=\"#a34343\" d=\"M35 31 H44 L49 47 54 31 H63 L53 56 H45Z\"/><path d=\"M14 8 V94\" stroke=\"#735640\" stroke-width=\"5\"/>"},
{"id":"scallop-frame","name":"Scalloped name frame","category":"Frames","art":"<rect x=\"10\" y=\"23\" width=\"80\" height=\"54\" rx=\"20\" fill=\"none\" stroke=\"#b86e83\" stroke-width=\"4\"/><path d=\"M20 23 Q30 8 40 23 Q50 8 60 23 Q70 8 80 23 M20 77 Q30 92 40 77 Q50 92 60 77 Q70 92 80 77\" fill=\"none\" stroke=\"#b86e83\" stroke-width=\"3\"/>"},
{"id":"oval-name-frame","name":"Oval name frame","category":"Frames","art":"<ellipse cx=\"50\" cy=\"50\" rx=\"44\" ry=\"30\" fill=\"none\" stroke=\"#789779\" stroke-width=\"4\"/><ellipse cx=\"50\" cy=\"50\" rx=\"38\" ry=\"24\" fill=\"none\" stroke=\"#789779\" stroke-width=\"2\"/>"},
{"id":"sparkle-accent","name":"Sparkle accents","category":"Decorations","art":"<path fill=\"#c18b32\" d=\"M50 8 L57 40 90 50 57 60 50 92 43 60 10 50 43 40Z M18 8 L22 18 32 22 22 26 18 36 14 26 4 22 14 18Z\"/>"},
{"id":"leaf-divider","name":"Leaf divider","category":"Decorations","art":"<path d=\"M8 50 H92\" stroke=\"#47775b\" stroke-width=\"3\"/><path fill=\"#73977b\" d=\"M30 50 Q8 22 42 36 L50 50 Q70 22 90 36 L65 50 Q90 78 58 65 L50 50 Q30 78 10 65Z\"/>"},
{"id":"simple-cross-element","name":"Classic cross","category":"Faith","art":"<path fill=\"#9473b8\" d=\"M40 8 H60 V34 H84 V54 H60 V92 H40 V54 H16 V34 H40Z\"/>"},
{"id":"ribbon-banner-element","name":"Ribbon name banner","category":"Frames","art":"<path fill=\"#b86e83\" d=\"M5 28 H25 V72 H5 L15 50Z M95 28 H75 V72 H95 L85 50Z\"/><rect x=\"18\" y=\"20\" width=\"64\" height=\"60\" rx=\"6\" fill=\"none\" stroke=\"#b86e83\" stroke-width=\"4\"/>"},
{id:'heart',name:'Classic heart',category:'Everyday',art:'<path fill="#b84d65" d="M50 85 C15 60 5 42 19 25 C30 12 45 18 50 32 C55 18 70 12 81 25 C95 42 85 60 50 85Z"/>'},
{id:'star',name:'Five-point star',category:'Everyday',art:'<path fill="#c18b32" d="M50 8 L62 36 93 38 69 58 77 89 50 72 23 89 31 58 7 38 38 36Z"/>'},
{id:'leaf',name:'Botanical leaf',category:'Nature',art:'<path fill="#73977b" d="M16 85 Q8 12 88 12 Q90 80 16 85Z"/><path d="M16 85 Q48 48 80 20" stroke="#234536" stroke-width="3" fill="none"/>'},
{id:'football',name:'Classic football',category:'Sports',art:'<path fill="#945c38" d="M8 50 Q50 -5 92 50 Q50 105 8 50Z"/><path stroke="#fffdf5" stroke-width="3" fill="none" d="M30 50 H70 M38 43 V57 M46 43 V57 M54 43 V57 M62 43 V57"/>'},
{id:'bow',name:'Ribbon bow',category:'Everyday',art:'<path fill="#b86e83" d="M46 45 Q4 5 8 45 Q4 82 46 55 L24 90 43 83 50 61 57 83 76 90 54 55 Q96 82 92 45 Q96 5 54 45Z"/><rect x="44" y="40" width="12" height="20" rx="4" fill="#8d455d"/>'},
{id:'mountain',name:'Mountain badge',category:'Nature',art:'<circle cx="50" cy="50" r="43" fill="#e5ede6"/><path fill="#315b47" d="M12 70 L39 24 58 55 72 37 89 70Z"/><path fill="#fffdf5" d="M39 24 L29 41 39 36 49 41Z"/>'},
{"id":"wildflower","name":"Wildflower sprig","category":"Botanical","art":"<path d=\"M50 90 Q35 55 48 18 M45 65 Q20 50 20 35 M45 75 Q75 58 78 40\" fill=\"none\" stroke=\"#47775b\" stroke-width=\"3\"/><path fill=\"#779b69\" d=\"M43 65 Q12 65 17 45 Q38 46 43 65 M48 74 Q75 48 84 59 Q80 78 48 74\"/><g fill=\"#d68a9e\"><circle cx=\"48\" cy=\"13\" r=\"9\"/><circle cx=\"38\" cy=\"23\" r=\"8\"/><circle cx=\"58\" cy=\"23\" r=\"8\"/><circle cx=\"20\" cy=\"30\" r=\"8\"/><circle cx=\"78\" cy=\"35\" r=\"8\"/></g><circle cx=\"48\" cy=\"23\" r=\"5\" fill=\"#d7a84c\"/>"},
{"id":"sunrise","name":"Sunrise adventure patch","category":"Patches","art":"<circle cx=\"50\" cy=\"50\" r=\"43\" fill=\"#233c58\"/><circle cx=\"50\" cy=\"42\" r=\"23\" fill=\"#e5a34d\"/><path fill=\"#658d9a\" d=\"M10 64 L33 34 53 63 68 44 90 64 78 81 50 92 22 81Z\"/><path fill=\"#f5eee0\" d=\"M23 47 L33 34 43 49 33 44Z M60 55 L68 44 77 56 68 52Z\"/><circle cx=\"50\" cy=\"50\" r=\"43\" fill=\"none\" stroke=\"#d9c7a4\" stroke-width=\"3\"/>"},
{"id":"baseball","name":"Baseball diamond","category":"Sports","art":"<path fill=\"#284c6d\" d=\"M50 5 L95 50 50 95 5 50Z\"/><circle cx=\"50\" cy=\"50\" r=\"29\" fill=\"#f6eee0\"/><path d=\"M32 28 Q49 50 32 72 M68 28 Q51 50 68 72 M31 36 L40 32 M35 48 L44 46 M31 62 L40 65 M69 36 L60 32 M65 48 L56 46 M69 62 L60 65\" fill=\"none\" stroke=\"#b83c46\" stroke-width=\"2.5\"/>"},
{"id":"anchor","name":"Coastal anchor","category":"Coastal","art":"<circle cx=\"50\" cy=\"18\" r=\"8\" fill=\"none\" stroke=\"#234b70\" stroke-width=\"5\"/><path d=\"M50 26 V82 M30 38 H70 M18 58 Q18 85 50 85 Q82 85 82 58\" fill=\"none\" stroke=\"#234b70\" stroke-width=\"6\"/><path fill=\"#234b70\" d=\"M8 62 L18 48 29 62Z M71 62 L82 48 92 62Z\"/><path d=\"M39 31 Q68 46 41 59 Q28 68 54 78\" fill=\"none\" stroke=\"#c49a60\" stroke-width=\"3\"/>"},
{"id":"butterfly","name":"Garden butterfly","category":"Botanical","art":"<path fill=\"#769ac4\" d=\"M47 48 Q4 2 9 39 Q8 60 43 57 Q7 69 25 87 Q43 96 49 61Z M53 48 Q96 2 91 39 Q92 60 57 57 Q93 69 75 87 Q57 96 51 61Z\"/><path fill=\"#e7b36b\" d=\"M40 43 Q18 19 19 39 Q20 49 40 50Z M60 43 Q82 19 81 39 Q80 49 60 50Z\"/><path d=\"M50 40 V77 M50 40 L40 26 M50 40 L60 26\" stroke=\"#263c56\" stroke-width=\"4\" fill=\"none\"/>"},
{"id":"laurel","name":"Laurel monogram frame","category":"Monograms","art":"<path d=\"M46 87 Q10 65 24 22 M54 87 Q90 65 76 22\" stroke=\"#47775b\" stroke-width=\"2.5\" fill=\"none\"/><g fill=\"#73977b\"><path d=\"M24 35 Q5 20 15 12 Q30 20 24 35 M21 49 Q2 39 8 29 Q23 32 21 49 M26 65 Q7 61 8 48 Q25 49 26 65 M37 78 Q17 79 14 66 Q31 62 37 78 M76 35 Q95 20 85 12 Q70 20 76 35 M79 49 Q98 39 92 29 Q77 32 79 49 M74 65 Q93 61 92 48 Q75 49 74 65 M63 78 Q83 79 86 66 Q69 62 63 78\"/></g><path d=\"M38 87 Q50 80 62 87\" stroke=\"#c19a57\" stroke-width=\"3\" fill=\"none\"/>"},
{"id":"bear","name":"Honey bear","category":"Characters","art":"<g fill=\"#aa754d\"><circle cx=\"25\" cy=\"24\" r=\"14\"/><circle cx=\"75\" cy=\"24\" r=\"14\"/><ellipse cx=\"50\" cy=\"76\" rx=\"27\" ry=\"19\"/><ellipse cx=\"50\" cy=\"45\" rx=\"36\" ry=\"31\"/></g><g fill=\"#e9c39a\"><circle cx=\"25\" cy=\"24\" r=\"8\"/><circle cx=\"75\" cy=\"24\" r=\"8\"/><ellipse cx=\"50\" cy=\"58\" rx=\"17\" ry=\"12\"/></g><g fill=\"#292b35\"><ellipse cx=\"39\" cy=\"48\" rx=\"3\" ry=\"4\"/><ellipse cx=\"61\" cy=\"48\" rx=\"3\" ry=\"4\"/></g><path d=\"M45 59 Q50 64 55 59\" fill=\"none\" stroke=\"#292b35\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><g fill=\"#e6a0a0\"><ellipse cx=\"30\" cy=\"57\" rx=\"5\" ry=\"3\"/><ellipse cx=\"70\" cy=\"57\" rx=\"5\" ry=\"3\"/></g><ellipse cx=\"50\" cy=\"54\" rx=\"5\" ry=\"3\" fill=\"#50382c\"/><path d=\"M35 76 L50 82 65 76 65 89 50 84 35 89Z\" fill=\"#537e9b\"/>"},
{"id":"bunny","name":"Meadow bunny","category":"Characters","art":"<g fill=\"#d6c5b5\"><ellipse cx=\"34\" cy=\"25\" rx=\"12\" ry=\"23\"/><ellipse cx=\"66\" cy=\"25\" rx=\"12\" ry=\"23\"/><ellipse cx=\"50\" cy=\"77\" rx=\"26\" ry=\"19\"/><ellipse cx=\"50\" cy=\"51\" rx=\"34\" ry=\"28\"/></g><g fill=\"#d99da8\"><ellipse cx=\"34\" cy=\"24\" rx=\"5\" ry=\"15\"/><ellipse cx=\"66\" cy=\"24\" rx=\"5\" ry=\"15\"/></g><g fill=\"#292b35\"><ellipse cx=\"39\" cy=\"48\" rx=\"3\" ry=\"4\"/><ellipse cx=\"61\" cy=\"48\" rx=\"3\" ry=\"4\"/></g><path d=\"M45 59 Q50 64 55 59\" fill=\"none\" stroke=\"#292b35\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><g fill=\"#e6a0a0\"><ellipse cx=\"30\" cy=\"57\" rx=\"5\" ry=\"3\"/><ellipse cx=\"70\" cy=\"57\" rx=\"5\" ry=\"3\"/></g><path d=\"M50 76 L63 68 61 88Z\" fill=\"#e99448\"/><path d=\"M63 68 L68 60 M63 68 L73 65\" stroke=\"#54855e\" stroke-width=\"3\"/>"},
{"id":"fox","name":"Woodland fox","category":"Characters","art":"<path fill=\"#c86e38\" d=\"M12 13 L39 28 Q50 23 61 28 L88 13 82 61 Q70 82 50 85 Q30 82 18 61Z\"/><path fill=\"#f4ddbc\" d=\"M20 46 Q39 45 50 66 Q61 45 80 46 L76 67 Q64 83 50 85 Q36 83 24 67Z\"/><path fill=\"#75443c\" d=\"M20 23 L35 32 23 40Z M80 23 L65 32 77 40Z\"/><g fill=\"#292b35\"><ellipse cx=\"39\" cy=\"48\" rx=\"3\" ry=\"4\"/><ellipse cx=\"61\" cy=\"48\" rx=\"3\" ry=\"4\"/></g><path d=\"M45 59 Q50 64 55 59\" fill=\"none\" stroke=\"#292b35\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><g fill=\"#e6a0a0\"><ellipse cx=\"30\" cy=\"57\" rx=\"5\" ry=\"3\"/><ellipse cx=\"70\" cy=\"57\" rx=\"5\" ry=\"3\"/></g><ellipse cx=\"50\" cy=\"65\" rx=\"5\" ry=\"3\" fill=\"#292b35\"/>"},
{"id":"penguin","name":"Cozy penguin","category":"Characters","art":"<ellipse cx=\"50\" cy=\"53\" rx=\"32\" ry=\"40\" fill=\"#35465c\"/><ellipse cx=\"50\" cy=\"61\" rx=\"23\" ry=\"28\" fill=\"#f4eee1\"/><path d=\"M20 48 Q2 60 14 77 L29 65 M80 48 Q98 60 86 77 L71 65\" fill=\"#35465c\"/><g fill=\"#e4a24d\"><ellipse cx=\"36\" cy=\"91\" rx=\"12\" ry=\"5\"/><ellipse cx=\"64\" cy=\"91\" rx=\"12\" ry=\"5\"/><path d=\"M44 54 H56 L50 61Z\"/></g><g fill=\"#292b35\"><circle cx=\"39\" cy=\"47\" r=\"3\"/><circle cx=\"61\" cy=\"47\" r=\"3\"/></g><path d=\"M22 33 Q50 40 78 33 L75 22 Q50 29 25 22Z\" fill=\"#ba5265\"/><circle cx=\"50\" cy=\"11\" r=\"8\" fill=\"#ba5265\"/>"},
{"id":"dino","name":"Little dinosaur","category":"Characters","art":"<path fill=\"#6c9b70\" d=\"M8 69 Q22 81 35 63 L39 39 Q39 15 61 15 Q87 15 88 36 L85 48 65 49 65 77 78 83 78 91 55 91 49 80 43 91 23 91 24 81 Q10 81 8 69Z\"/><path fill=\"#e7b65d\" d=\"M40 39 L30 31 40 24 35 15 49 18 52 7 63 15Z\"/><ellipse cx=\"62\" cy=\"67\" rx=\"9\" ry=\"13\" fill=\"#b7ce8a\"/><circle cx=\"72\" cy=\"31\" r=\"4\" fill=\"#293b34\"/><path d=\"M74 42 Q81 45 85 40\" fill=\"none\" stroke=\"#293b34\" stroke-width=\"2\"/>"},
{"id":"whale","name":"Happy little whale","category":"Coastal","art":"<path fill=\"#689cc0\" d=\"M8 48 Q25 56 35 41 Q49 20 71 35 Q96 48 85 72 Q74 91 44 83 Q20 78 18 61 Q6 61 8 48Z\"/><path fill=\"#b5d7e6\" d=\"M31 71 Q58 83 84 66 Q76 91 44 83Z\"/><circle cx=\"72\" cy=\"49\" r=\"3.5\" fill=\"#293b4a\"/><path d=\"M69 61 Q75 65 80 59\" stroke=\"#293b4a\" stroke-width=\"2\" fill=\"none\"/><path d=\"M56 28 Q43 10 36 21 M56 28 Q69 10 76 21\" stroke=\"#689cc0\" stroke-width=\"4\" fill=\"none\"/>"},
{"id":"ghost","name":"Friendly ghost","category":"Seasonal","art":"<path fill=\"#e5e1f2\" stroke=\"#766b9b\" stroke-width=\"2\" d=\"M16 83 V43 Q16 9 50 9 Q84 9 84 43 V83 L72 72 61 87 50 73 39 87 28 72Z\"/><g fill=\"#292b35\"><ellipse cx=\"39\" cy=\"48\" rx=\"3\" ry=\"4\"/><ellipse cx=\"61\" cy=\"48\" rx=\"3\" ry=\"4\"/></g><path d=\"M45 59 Q50 64 55 59\" fill=\"none\" stroke=\"#292b35\" stroke-width=\"2.5\" stroke-linecap=\"round\"/><g fill=\"#e6a0a0\"><ellipse cx=\"30\" cy=\"57\" rx=\"5\" ry=\"3\"/><ellipse cx=\"70\" cy=\"57\" rx=\"5\" ry=\"3\"/></g><path fill=\"#e6a04d\" d=\"M35 76 Q50 63 65 76 L60 88 H40Z\"/>"},
{"id":"rocket","name":"Space explorer","category":"Kids","art":"<path fill=\"#b95b52\" d=\"M37 57 L20 80 38 76 M63 57 L80 80 62 76Z\"/><path fill=\"#e6e5df\" stroke=\"#466584\" stroke-width=\"2\" d=\"M50 7 Q77 28 65 69 L35 69 Q23 28 50 7Z\"/><path fill=\"#b95b52\" d=\"M50 7 Q63 18 67 31 H33 Q37 18 50 7Z\"/><circle cx=\"50\" cy=\"45\" r=\"12\" fill=\"#466584\"/><circle cx=\"50\" cy=\"45\" r=\"7\" fill=\"#9bcce4\"/><path fill=\"#e5a54a\" d=\"M39 72 H61 L50 96Z\"/><path fill=\"#b95b52\" d=\"M46 73 H54 L50 87Z\"/>"},
{"id":"puppy","name":"Playful puppy","category":"Characters","art":"<path fill=\"#a67550\" d=\"M22 24 Q0 24 9 65 L28 60 M78 24 Q100 24 91 65 L72 60\"/><ellipse cx=\"50\" cy=\"49\" rx=\"32\" ry=\"34\" fill=\"#e5bd91\"/><ellipse cx=\"50\" cy=\"63\" rx=\"20\" ry=\"15\" fill=\"#fff0da\"/><g fill=\"#292b35\"><circle cx=\"36\" cy=\"45\" r=\"4\"/><circle cx=\"64\" cy=\"45\" r=\"4\"/><ellipse cx=\"50\" cy=\"57\" rx=\"7\" ry=\"5\"/></g><path d=\"M42 67 Q50 76 58 67\" stroke=\"#49362d\" stroke-width=\"3\" fill=\"none\"/><path d=\"M27 82 H73 V90 H27Z\" fill=\"#468bb6\"/>"},
{"id":"mouse","name":"Vintage storybook mouse","category":"Characters","art":"<g fill=\"#55505a\"><circle cx=\"22\" cy=\"24\" r=\"18\"/><circle cx=\"78\" cy=\"24\" r=\"18\"/><ellipse cx=\"50\" cy=\"52\" rx=\"36\" ry=\"35\"/></g><g fill=\"#e8b5ad\"><circle cx=\"22\" cy=\"24\" r=\"10\"/><circle cx=\"78\" cy=\"24\" r=\"10\"/></g><ellipse cx=\"50\" cy=\"61\" rx=\"26\" ry=\"21\" fill=\"#f0d5b5\"/><g fill=\"#302d36\"><circle cx=\"37\" cy=\"48\" r=\"4\"/><circle cx=\"63\" cy=\"48\" r=\"4\"/><ellipse cx=\"50\" cy=\"60\" rx=\"6\" ry=\"4\"/></g><path d=\"M40 70 Q50 78 60 70\" fill=\"none\" stroke=\"#302d36\" stroke-width=\"3\"/><path fill=\"#b85d66\" d=\"M30 83 L50 89 70 83 70 97 50 92 30 97Z\"/>"},
{"id":"turtle","name":"Sea turtle","category":"Coastal","art":"<g fill=\"#679a83\"><ellipse cx=\"50\" cy=\"17\" rx=\"12\" ry=\"15\"/><ellipse cx=\"19\" cy=\"39\" rx=\"12\" ry=\"19\" transform=\"rotate(-40 19 39)\"/><ellipse cx=\"81\" cy=\"39\" rx=\"12\" ry=\"19\" transform=\"rotate(40 81 39)\"/><ellipse cx=\"28\" cy=\"77\" rx=\"10\" ry=\"15\"/><ellipse cx=\"72\" cy=\"77\" rx=\"10\" ry=\"15\"/></g><ellipse cx=\"50\" cy=\"53\" rx=\"29\" ry=\"35\" fill=\"#3c786b\"/><path d=\"M50 25 L69 39 62 62 38 62 31 39Z M38 62 L29 75 M62 62 L71 75\" stroke=\"#d4bd7d\" stroke-width=\"3\" fill=\"none\"/><circle cx=\"45\" cy=\"12\" r=\"2\" fill=\"#243e39\"/><circle cx=\"55\" cy=\"12\" r=\"2\" fill=\"#243e39\"/>"},
{"id":"gingerbread","name":"Gingerbread friend","category":"Seasonal","art":"<path fill=\"#b77b4c\" d=\"M50 5 A19 19 0 0 1 66 34 L88 47 Q97 61 82 66 L67 57 72 85 Q74 98 59 96 L50 76 41 96 Q26 98 28 85 L33 57 18 66 Q3 61 12 47 L34 34 A19 19 0 0 1 50 5Z\"/><g fill=\"#fff1dd\"><circle cx=\"43\" cy=\"23\" r=\"3\"/><circle cx=\"57\" cy=\"23\" r=\"3\"/><circle cx=\"50\" cy=\"52\" r=\"4\"/><circle cx=\"50\" cy=\"64\" r=\"4\"/></g><path d=\"M42 31 Q50 38 58 31 M15 51 L23 58 M77 58 L85 51 M32 85 H41 M59 85 H68\" fill=\"none\" stroke=\"#fff1dd\" stroke-width=\"3\"/><path fill=\"#b94755\" d=\"M35 39 L50 44 65 39 65 49 50 45 35 49Z\"/>"},
{"id":"duck","name":"Rainy day duck","category":"Baby","art":"<ellipse cx=\"48\" cy=\"69\" rx=\"36\" ry=\"23\" fill=\"#e6b84e\"/><circle cx=\"63\" cy=\"35\" r=\"24\" fill=\"#f1cd63\"/><path fill=\"#d98a43\" d=\"M79 35 L97 43 79 49Z\"/><ellipse cx=\"40\" cy=\"69\" rx=\"18\" ry=\"12\" fill=\"#cda047\"/><circle cx=\"70\" cy=\"29\" r=\"4\" fill=\"#34343c\"/><path fill=\"#6599b5\" d=\"M38 19 Q63 0 86 19 L90 25 H35Z\"/>"},
{"id":"sailboat","name":"Coastal sailboat","category":"Coastal","art":"<path fill=\"#e5d3ac\" d=\"M48 8 V65 H10Z\"/><path fill=\"#739dbb\" d=\"M54 17 V65 H85Z\"/><path fill=\"#9b4b48\" d=\"M10 70 H90 L75 85 H25Z\"/><path d=\"M51 7 V70\" stroke=\"#34495c\" stroke-width=\"3\"/><path d=\"M5 91 Q16 84 27 91 T49 91 T71 91 T93 91\" fill=\"none\" stroke=\"#739dbb\" stroke-width=\"3\"/>"},
{"id":"coquette","name":"Pink coquette ribbon","category":"Bows","art":"<path fill=\"#efb0c5\" stroke=\"#b96a8a\" stroke-width=\"2\" d=\"M46 48 Q15 8 7 26 Q0 47 15 60 Q30 64 46 53 L24 91 42 83 51 58 63 91 78 84 56 53 Q85 70 94 46 Q99 15 83 21 Q68 24 54 48Z\"/><path d=\"M15 32 Q30 32 45 49 M85 32 Q70 32 55 49\" fill=\"none\" stroke=\"#b96a8a\" stroke-width=\"2\"/><rect x=\"43\" y=\"42\" width=\"14\" height=\"17\" rx=\"5\" fill=\"#b96a8a\"/>"},
{"id":"bluebow","name":"Powder blue ribbon","category":"Bows","art":"<path fill=\"#a9cce9\" stroke=\"#5686b2\" stroke-width=\"2\" d=\"M46 48 Q15 8 7 26 Q0 47 15 60 Q30 64 46 53 L24 91 42 83 51 58 63 91 78 84 56 53 Q85 70 94 46 Q99 15 83 21 Q68 24 54 48Z\"/><path d=\"M15 32 Q30 32 45 49 M85 32 Q70 32 55 49\" fill=\"none\" stroke=\"#5686b2\" stroke-width=\"2\"/><rect x=\"43\" y=\"42\" width=\"14\" height=\"17\" rx=\"5\" fill=\"#5686b2\"/>"},
{"id":"cherrybow","name":"Cherry ribbon","category":"Bows","art":"<path fill=\"#e75b71\" stroke=\"#a62c48\" stroke-width=\"2\" d=\"M46 48 Q15 8 7 26 Q0 47 15 60 Q30 64 46 53 L24 91 42 83 51 58 63 91 78 84 56 53 Q85 70 94 46 Q99 15 83 21 Q68 24 54 48Z\"/><path d=\"M15 32 Q30 32 45 49 M85 32 Q70 32 55 49\" fill=\"none\" stroke=\"#a62c48\" stroke-width=\"2\"/><rect x=\"43\" y=\"42\" width=\"14\" height=\"17\" rx=\"5\" fill=\"#a62c48\"/><g fill=\"#fff0e8\"><circle cx=\"20\" cy=\"36\" r=\"3\"/><circle cx=\"30\" cy=\"45\" r=\"3\"/><circle cx=\"80\" cy=\"36\" r=\"3\"/><circle cx=\"70\" cy=\"45\" r=\"3\"/></g>"},
{"id":"rainbow","name":"Pastel rainbow","category":"Cute & boutique","art":"<g fill=\"none\" stroke-width=\"8\"><path d=\"M10 76 V53 A40 40 0 0 1 90 53 V76\" stroke=\"#d98fa5\"/><path d=\"M21 76 V53 A29 29 0 0 1 79 53 V76\" stroke=\"#e8b57c\"/><path d=\"M32 76 V53 A18 18 0 0 1 68 53 V76\" stroke=\"#a6bd9b\"/><path d=\"M43 76 V53 A7 7 0 0 1 57 53 V76\" stroke=\"#8eb5d2\"/></g>"},
{"id":"cherries","name":"Sweet cherries","category":"Cute & boutique","art":"<path d=\"M30 65 Q30 30 58 16 Q73 30 72 66\" stroke=\"#54855b\" stroke-width=\"4\" fill=\"none\"/><path fill=\"#79a575\" d=\"M58 16 Q72 0 91 12 Q80 32 58 16Z\"/><g fill=\"#d84a61\"><circle cx=\"28\" cy=\"72\" r=\"19\"/><circle cx=\"72\" cy=\"72\" r=\"19\"/></g><g fill=\"#f6b0b7\"><ellipse cx=\"21\" cy=\"64\" rx=\"4\" ry=\"6\"/><ellipse cx=\"65\" cy=\"64\" rx=\"4\" ry=\"6\"/></g>"},
{"id":"strawberry","name":"Strawberry sweetheart","category":"Cute & boutique","art":"<path fill=\"#e86b7c\" d=\"M50 28 Q12 12 13 47 Q18 80 50 95 Q82 80 87 47 Q88 12 50 28Z\"/><path fill=\"#68966a\" d=\"M50 29 L22 13 43 15 50 4 57 15 78 13Z\"/><g fill=\"#f8dfb2\"><ellipse cx=\"30\" cy=\"42\" rx=\"2\" ry=\"4\"/><ellipse cx=\"50\" cy=\"40\" rx=\"2\" ry=\"4\"/><ellipse cx=\"70\" cy=\"42\" rx=\"2\" ry=\"4\"/><ellipse cx=\"40\" cy=\"58\" rx=\"2\" ry=\"4\"/><ellipse cx=\"60\" cy=\"58\" rx=\"2\" ry=\"4\"/><ellipse cx=\"50\" cy=\"76\" rx=\"2\" ry=\"4\"/></g>"},
{"id":"unicorn","name":"Pastel unicorn","category":"Kids","art":"<path fill=\"#f5e8db\" stroke=\"#aa91ae\" stroke-width=\"2\" d=\"M24 32 L20 12 42 25 Q73 15 78 48 L91 68 Q84 89 52 86 L23 76Z\"/><path fill=\"#d5a1c8\" d=\"M24 32 Q5 43 14 83 L35 88 Q22 62 43 29Z\"/><path fill=\"#e5b65e\" d=\"M47 28 L55 3 64 28Z\"/><path d=\"M53 50 Q60 57 67 50\" stroke=\"#55415c\" stroke-width=\"3\" fill=\"none\"/><ellipse cx=\"68\" cy=\"65\" rx=\"8\" ry=\"4\" fill=\"#e9a4b7\"/>"},
{"id":"pumpkin","name":"Sweet pumpkin","category":"Seasonal","art":"<g fill=\"#df9654\" stroke=\"#b8753d\" stroke-width=\"2\"><ellipse cx=\"30\" cy=\"58\" rx=\"23\" ry=\"32\"/><ellipse cx=\"70\" cy=\"58\" rx=\"23\" ry=\"32\"/><ellipse cx=\"50\" cy=\"58\" rx=\"23\" ry=\"35\"/></g><path d=\"M50 26 Q44 12 60 8\" stroke=\"#68855a\" stroke-width=\"7\" fill=\"none\"/><g fill=\"#493a37\"><circle cx=\"37\" cy=\"55\" r=\"4\"/><circle cx=\"63\" cy=\"55\" r=\"4\"/></g><path d=\"M42 68 Q50 76 58 68\" stroke=\"#493a37\" stroke-width=\"3\" fill=\"none\"/>"},
{"id":"shell","name":"Scallop shell","category":"Coastal","art":"<path fill=\"#edc0a8\" stroke=\"#b97f70\" stroke-width=\"2\" d=\"M50 91 Q5 67 5 38 Q5 20 20 25 Q20 5 37 14 Q50 0 63 14 Q80 5 80 25 Q95 20 95 38 Q95 67 50 91Z\"/><path d=\"M50 86 L20 30 M50 86 L37 19 M50 86 V12 M50 86 L63 19 M50 86 L80 30\" stroke=\"#b97f70\" stroke-width=\"2\" fill=\"none\"/>"},
{"id":"frame","name":"Scalloped monogram frame","category":"Cute & boutique","art":"<path d=\"M50 9 Q60 1 68 15 Q83 10 85 26 Q99 32 91 45 Q101 58 87 68 Q90 85 73 85 Q62 99 50 91 Q38 99 27 85 Q10 85 13 68 Q-1 58 9 45 Q1 32 15 26 Q17 10 32 15 Q40 1 50 9Z\" fill=\"none\" stroke=\"#b97c9b\" stroke-width=\"4\"/><circle cx=\"50\" cy=\"50\" r=\"30\" fill=\"none\" stroke=\"#e2b0c7\" stroke-width=\"2\"/>"},
{id:'prairie-flower',name:'Prairie coneflower',category:'Botanical',art:'<path id="tl-satin" d="M51 87 Q43 57 50 39" fill="none" stroke="#557a58" stroke-width="4"/><path fill="#7a9a66" d="M49 69 Q27 70 21 54 Q39 53 49 69Z M49 76 Q65 57 81 65 Q72 83 49 76Z"/><path fill="#b45878" d="M38 38 Q19 18 24 34 Q26 53 42 50Z M46 40 Q31 50 39 62 Q52 61 55 42Z M55 39 Q62 64 72 54 Q75 47 65 36Z M66 35 Q84 45 84 31 Q78 21 63 27Z"/><ellipse fill="#835032" cx="51" cy="34" rx="18" ry="11"/>'},
{id:'spool-mark',name:'Thread spool',category:'Everyday',art:'<path fill="#6945a2" d="M29 25 H71 V75 H29Z"/><path fill="#ceaddd" d="M31 35 H69 V65 H31Z"/><path fill="none" stroke="#8463a3" stroke-width="3" d="M31 42 L69 38 M31 51 L69 47 M31 60 L69 56"/><rect fill="#443358" x="22" y="22" width="56" height="10" rx="4"/><rect fill="#443358" x="22" y="68" width="56" height="10" rx="4"/>'},
{id:'pine-patch',name:'Three pines patch',category:'Patches',art:'<path fill="#ecd9aa" d="M50 9 L86 27 V67 L50 91 14 67 V27Z"/><path fill="none" stroke="#304c48" stroke-width="4" d="M50 9 L86 27 V67 L50 91 14 67 V27Z"/><path fill="#52735a" d="M34 40 L22 62 H46Z M66 40 L54 62 H78Z"/><path fill="#31564b" d="M50 30 L34 67 H66Z"/>'},
{id:'sunday-ball',name:'Sunday football badge',category:'Sports',art:'<ellipse fill="#e9dcba" cx="50" cy="50" rx="44" ry="38"/><ellipse fill="none" stroke="#324750" stroke-width="4" cx="50" cy="50" rx="44" ry="38"/><path fill="#995d3a" d="M18 50 Q50 9 82 50 Q50 91 18 50Z"/><path d="M34 50 H66 M39 44 V56 M46 44 V56 M54 44 V56 M61 44 V56" fill="none" stroke="#fff1d5" stroke-width="2.4"/>'},
  ...twemojiTemplates,
];
type TemplatePlan = { stitches: number; trims: number; blocks: { color: number[]; runs: number[][][] }[] };

export function TemplateAttribution({template}: {template: Template}) {
  const attribution = template.attribution;
  if (!attribution) return null;
  return <small className="muted">
    <a href={attribution.sourceUrl} target="_blank" rel="noreferrer">{attribution.credit}</a> ·{' '}
    <a href={attribution.licenseUrl} target="_blank" rel="noreferrer">{attribution.license}</a>
    {' '}· Stitch rendering adapts the source artwork.
  </small>;
}

function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter(item => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberTemplate(id:string){
  const next=[id,...readIds('studio-design-recent').filter(previous=>previous!==id)].slice(0,20);
  localStorage.setItem('studio-design-recent',JSON.stringify(next));
  window.dispatchEvent(new Event('studio-template-used'));
  return next;
}
function TemplatePreview({ template, widthMm, insert, onCancel, onChoose }: {
  template: Template; widthMm: number; insert: boolean; onCancel: () => void; onChoose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [plan, setPlan] = useState<TemplatePlan | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void invoke<TemplatePlan>('preview_template', { id: template.id, art: template.art, widthMm })
      .then(result => { if (active) setPlan(result); })
      .catch(err => { if (active) setError(String(err)); });
    return () => { active = false; };
  }, [template, widthMm]);
  return <dialog ref={dialog} className="studio-modal template-preview-dialog" aria-label={template.name} onClose={onCancel}>
    <header className="studio-modal-heading">
      <div><small>{template.category}</small><h2>{template.name}</h2></div>
      <button title="Close preview" aria-label="Close preview" onClick={onCancel}><X size={18} /></button>
    </header>
    <div className="template-preview-grid">
      <section><h3>Artwork</h3><svg viewBox="0 0 100 100" dangerouslySetInnerHTML={{ __html: template.art }} /></section>
      <section><h3>Stitch preview</h3>
        {plan ? <svg aria-label="Generated template stitches" viewBox={`${-widthMm / 2} ${-widthMm / 2} ${widthMm} ${widthMm}`}>
          {plan.blocks.map((block, index) => <g key={index} fill="none" stroke={`rgb(${block.color.join(',')})`} strokeWidth=".28">
            {block.runs.map((run, runIndex) => <polyline key={runIndex} points={run.map(point => point.join(',')).join(' ')} />)}
          </g>)}
        </svg> : <p role={error ? 'alert' : 'status'}>{error || 'Generating stitches…'}</p>}
      </section>
    </div>
    {plan && <p>{plan.stitches.toLocaleString()} stitch points · {plan.blocks.length} color blocks · {plan.trims} planned trims</p>}
    <TemplateAttribution template={template} />
    <footer className="studio-modal-actions">
      <button onClick={onCancel}>Back to library</button>
      <button className="primary" disabled={!plan} onClick={onChoose}>
        {insert ? 'Insert design' : 'Open in design studio'} <ArrowRight size={15} />
      </button>
    </footer>
  </dialog>;
}

type TemplateLibraryProps = {
  selectedId?: string;
} & ({ onChoose: (id: string) => void; insert?: boolean; widthMm?: number; onPreview?: never } |
     { onPreview: (template: Template) => void; onChoose?: never; insert?: never; widthMm?: never });

export function TemplateLibrary({ onChoose, insert = false, widthMm = 65, onPreview, selectedId }: TemplateLibraryProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [favorites, setFavorites] = useState(() => readIds('studio-design-favorites'));
  const [recent, setRecent] = useState(() => readIds('studio-design-recent'));
  useEffect(()=>{const refresh=()=>setRecent(readIds('studio-design-recent'));window.addEventListener('studio-template-used',refresh);return()=>window.removeEventListener('studio-template-used',refresh)},[]);
  const [selected, setSelected] = useState<Template | null>(null);
  const results = templates.filter(template => (
    category === 'All' || category === template.category
    || (category === 'Favorites' && favorites.includes(template.id))
    || (category === 'Recent' && recent.includes(template.id))
  ) && matchesName([template.name, template.category, ...(template.tags ?? [])].join(' '), query))
    .sort((a,b)=>category==='Recent'?recent.indexOf(a.id)-recent.indexOf(b.id):compareNames(a.name,b.name));
  const page=usePagedList(results,JSON.stringify([query,category]));
  const [limit,setLimit]=useState(36);
  const shown = onPreview ? results.slice(0,limit) : page.items;

  function choose(id: string) {
    setRecent(rememberTemplate(id));
    setSelected(null);
    onChoose?.(id);
  }

  function favorite(id: string) {
    const next = favorites.includes(id) ? favorites.filter(item => item !== id) : [...favorites, id];
    setFavorites(next);
    localStorage.setItem('studio-design-favorites', JSON.stringify(next));
  }

  return <>
    {!insert&&<div className="template-category-strip" role="group" aria-label="Featured categories">{['All','Favorites','Recent',...new Set(templates.map(t=>t.category))].map(item=><button key={item} aria-pressed={category===item} onClick={()=>{setCategory(item);setLimit(36)}}>{item}</button>)}</div>}
    <div className="library-filters">
      <label className="library-search"><Search size={16} /><input aria-label="Search templates" placeholder="Search templates" value={query} onChange={event => {setQuery(event.target.value);setLimit(36);}} /></label>
      <label>Category <select value={category} onChange={event => {setCategory(event.target.value);setLimit(36);}}>
        {['All', 'Favorites', 'Recent', ...new Set(templates.map(template => template.category))].map(item => <option key={item}>{item}</option>)}
      </select></label>
      <small>{results.length} {results.length === 1 ? 'design' : 'designs'}</small>
    </div>
    {results.length === 0 && <p role="status">No designs match your search.</p>}
    <section className="template-grid" aria-label="Template results">
      {shown.map(template => <article key={template.id} className={onPreview&&selectedId===template.id?'template-selected':undefined} draggable={!!onPreview} onDragStart={event=>{if(!onPreview)return;event.dataTransfer.setData("application/x-stitchstudio-template",template.id);event.dataTransfer.effectAllowed="copy";onPreview(template)}}>
        <button className="design-favorite" title="Toggle favorite"
          aria-label={(favorites.includes(template.id) ? 'Remove favorite ' : 'Favorite ') + template.name}
          aria-pressed={favorites.includes(template.id)} onClick={() => favorite(template.id)}>
          <Star size={15} fill={favorites.includes(template.id) ? 'currentColor' : 'none'} />
        </button>
        <button type="button" className="template-art-select" aria-label={'Select '+template.name} aria-pressed={onPreview?selectedId===template.id:undefined} onClick={()=>onPreview?onPreview(template):setSelected(template)}><svg className="template-art" viewBox="0 0 100 100" aria-hidden="true" dangerouslySetInnerHTML={{ __html: template.art }} /></button>
        <small>{template.category}</small>
        <h3>{template.name}</h3>
        <button onClick={() => onPreview ? onPreview(template) : setSelected(template)} aria-label={`Preview ${template.name}`}
          aria-pressed={onPreview ? selectedId === template.id : undefined}>
          {onPreview ? 'Select design' : 'Preview design'} <ArrowRight size={15} />
        </button>
      </article>)}
    </section>
    {onPreview ? results.length>limit&&<button onClick={()=>setLimit(previous=>previous+36)}>Show more templates</button> : <ListNavigation {...page}/>}
    {selected && <TemplatePreview template={selected} insert={insert} widthMm={widthMm}
      onCancel={() => setSelected(null)} onChoose={() => choose(selected.id)} />}
  </>;
}
