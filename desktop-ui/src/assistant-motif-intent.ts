import type {AssistantIntent} from './assistant-intent';

export type MotifPosition = 'center' | 'above' | 'below' | 'left' | 'right' |
  'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'sides' | 'topCorners' | 'bottomCorners';

const positions: [RegExp, MotifPosition][] = [
  [/^(?:to |on )?(?:the )?(?:(?:left and right|right and left)(?: (?:sides|corners))?|(?:both |either )(?:sides|ends)|around (?:the )?(?:letters|lettering|text|design))(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'sides'],
  [/^(?:on |at )?(?:the )?(?:both )?(?:top|upper)(?: (?:left and right|right and left))? corners?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'topCorners'],
  [/^(?:on |at )?(?:the )?(?:both )?(?:bottom|lower)(?: (?:left and right|right and left))? corners?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'bottomCorners'],
  [/^(?:on |at )?(?:the )?(?:top|upper)[ -]left(?: corner)?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'topLeft'],
  [/^(?:on |at )?(?:the )?(?:top|upper)[ -]right(?: corner)?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'topRight'],
  [/^(?:on |at )?(?:the )?(?:bottom|lower)[ -]left(?: corner)?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'bottomLeft'],
  [/^(?:on |at )?(?:the )?(?:bottom|lower)[ -]right(?: corner)?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'bottomRight'],
  [/^(?:to |on |at )?(?:the )?left(?: (?:side|corner))?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'left'],
  [/^(?:to |on |at )?(?:the )?right(?: (?:side|corner))?(?: of (?:the |my )?(?:letters|lettering|text|design|selection))?$/, 'right'],
  [/^(?:above|over|on top of)(?: (?:the |my )?(?:letters|lettering|text|design|selection|it))?$/, 'above'],
  [/^(?:below|under|underneath)(?: (?:the |my )?(?:letters|lettering|text|design|selection|it))?$/, 'below'],
  [/^here$/, 'center'],
  [/^(?:(?:in|at) )?(?:the )?(?:center|centre)(?: of (?:the |my )?(?:hoop|design|selection))?$/, 'center'],
];

export function parseMotifRequest(input: string): AssistantIntent | null {
  const add = input.match(/^(?:add|insert|place|put|draw) (.+)$/i);
  if (!add) return null;
  if (/^(?:(?:the )?(?:text|lettering|name) )?"/i.test(add[1]) && /^(?:(?:the )?(?:text|lettering|name) )?"[^"]+"(?: (?:at|size) [d.]+ ?(?:mm|cm|inches|inch|in)(?: tall)?)?$/i.test(add[1])) return null;
  let text = add[1].toLowerCase().replace(/\s+/g, ' ');
  if (/\b(?:and (?:add|insert|place|put|draw|resize|recolor|rotate)|then)\b/.test(text)) return null;
  const applique = /(?<![\p{L}])appliqu[eé](?![\p{L}])/u.test(text);
  // JavaScript word boundaries treat accented letters as non-word characters.
  text = text.replace(/(?: (?:for|as) (?:an? )?appliqu[eé]$)|(?:^appliqu[eé] )/gu, '');
  let width: number | undefined;
  const size = text.match(/(?:^| (?:(?:at|size) )?)(\d+(?:\.\d+)?)\s*[- ]?(mm|cm|inches|inch|in)(?:[- ]wide)?(?= |$)/);
  if (size?.index !== undefined) {
    width = Number(size[1]) * (size[2] === 'mm' ? 1 : size[2] === 'cm' ? 10 : 25.4);
    if (width < (applique ? 20 : 5) || width > 150) return null;
    text = (text.slice(0,size.index) + text.slice(size.index+size[0].length)).trim();
  }
  let relative: string | undefined;
  let position: MotifPosition = 'center';
  const gaps = [...text.matchAll(/ /g)];
  for (const space of gaps) {
    const rest = text.slice(space.index+1);
    const match = positions.find(([pattern]) => pattern.test(rest));
    if (match) {
      position = match[1];
      relative = /\b(?:letters|lettering|text)\b/.test(rest) ? 'lettering' :
        /\bselection\b/.test(rest) ? 'selection' : /\bdesign\b/.test(rest) ? 'design' :
        /\bhoop\b/.test(rest) ? 'hoop' : undefined;
      text = text.slice(0,space.index);
      break;
    }
  }
  if (/^(?:a pair of|two) /.test(text) && !['sides','topCorners','bottomCorners'].includes(position)) return null;
  const name = text.trim().replace(/^(?:(?:a pair of|two|some|a|an|the) )/, '')
    .replace(/^(?:appliqu[eé] )/, '')
    .replace(/^(?:(?:small|tiny|little|large|big) )/, '').replace(/[- ]looking (?:character|dog|puppy)$/, '').replace(/^"|"$/g, '').trim();
  if (!name || name.length > 90 || /^(?:text|lettering|name)\b/.test(name)) return null;
  const large = /\b(?:large|big)\b/.test(text), small = /\b(?:small|tiny|little)\b/.test(text);
  return {kind:'motif', text:name, position, applique, relative, width:width ?? (large ? 45 : small ? applique ? 20 : 15 : applique ? 30 : 24)};
}
