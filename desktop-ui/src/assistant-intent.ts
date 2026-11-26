export type AssistantIntent = {
  kind: string;
  value?: number;
  fabric?: string;
  previous?: number[];
  color?: number[];
  text?: string;
  size?: number;
  dx?: number;
  dy?: number;
  selected?: boolean;
  width?: number;
  height?: number;
};

const namedColors: ReadonlyMap<string, string> = new Map([
  ['black', '#000000'], ['white', '#ffffff'], ['red', '#ff0000'],
  ['blue', '#0000ff'], ['navy', '#000080'], ['navy blue', '#000080'],
  ['green', '#008000'], ['yellow', '#ffff00'], ['orange', '#ffa500'],
  ['purple', '#800080'], ['lavender', '#e6e6fa'], ['pink', '#ffc0cb'],
  ['gray', '#808080'], ['grey', '#808080'], ['teal', '#008080'],
]);

function parseColor(value: string): number[] | undefined {
  const name = value.replace(/^(?:all |the )+/, '').replace(/ (?:thread|stitches|objects|areas)$/, '');
  const hex = /^#[0-9a-f]{6}$/.test(name) ? name : namedColors.get(name);
  return hex ? [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) : undefined;
}

function millimeters(value: string, unit: string): number {
  return Number(value) * (unit === 'mm' ? 1 : unit === 'cm' ? 10 : 25.4);
}

export function assistantIntent(input: string): AssistantIntent | null {
 const maxPromptLength = 160;
 if (input.length > maxPromptLength) return null;
 const normalized = input.trim().replace(/[“”]/g, '"')
   .replace(/^(?:please\s+)?(?:(?:could|can|would|will) you\s+|i(?:'d| would) like (?:you )?to\s+|i want (?:you )?to\s+)?(?:please\s+)?/i, '')
   .replace(/[.!?]+$/, '').replace(/,?\s+please$/i, '');
 // Lettering retains its original casing and spacing.
 const lettering = normalized.match(/^(?:add|insert|embroider) (?:the )?(?:(?:text|lettering|name) )?"([^"\r\n]+)"(?: (?:at|size) (\d+(?:\.\d+)?)\s*(mm|cm|inches|inch|in)(?: tall)?)?$/i);
 if (lettering) {
   const size = lettering[2] ? millimeters(lettering[2], lettering[3].toLowerCase()) : 12;
   if (lettering[1].trim() && Array.from(lettering[1]).length <= 120 && size >= 3 && size <= 80) {
     return {kind:'lettering',text:lettering[1],size};
   }
   return null;
 }
 const s = normalized.toLowerCase().replace(/\s+/g, ' ');
 const hoop = s.match(/^(?:make (?:(?:this|the|my) design|it) fit|(?:resize|scale) (?:(?:this|the|my) design|it) to fit|fit(?: (?:this|the|my) design)?) (?:in |inside |to )?(?:(?:the|my|a|an) )?(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(mm|cm|inches|inch|in|")?[- ]*hoop$/);
 if (hoop) {
   const width = millimeters(hoop[1], hoop[3] ?? 'in');
   const height = millimeters(hoop[2], hoop[3] ?? 'in');
   return width >= 20 && height >= 20 && width <= 600 && height <= 600
     ? {kind:'fitDimensions',width,height} : null;
 }
 const time = s.match(/^(?:make (?:(?:this|the|my) design|it) (?:sew|stitch|take) (?:in )?(?:under|less than|within)|(?:hit|target|aim for)) (\d+(?:\.\d+)?)\s*(?:min(?:ute)?s?)(?: (?:of sewing|sewing time))?$/);
 if (time) {
   const value = Number(time[1]);
   return value >= 1 && value <= 600 ? {kind:'targetTime',value} : null;
 }
 const simplified = s.match(/^(?:simplify|smooth out|solidify) (?:(?:(?:the|this|my) )?(design|artwork|selected (?:objects?|design|artwork|region|lettering)|selection)|it)(?: (?:into a solid shape|without losing detail))?$/);
 if (simplified) {
   const intent: AssistantIntent = {kind:'simplify'};
   if (simplified[1]?.startsWith('select')) intent.selected = true;
   if (s.endsWith('into a solid shape') || s.startsWith('solidify ')) intent.value = 4;
   return intent;
 }
 const namedShape = s.match(/^(?:simplify|turn) (?:the )?([\p{L}\p{N}_ -]{1,40}) into a solid shape$/u);
 if (namedShape && !namedShape[1].includes(' and ')) return {kind:'simplify',text:namedShape[1],selected:true,value:4};
 if (/^(?:reduce|remove|eliminate) (?:(?:unnecessary|excessive) )?(?:thread )?(?:trims|cuts)(?: (?:from|in) (?:this|the|my) design)?$/.test(s)) {
   return {kind:'reduceTrims'};
 }
 const move=s.match(/^(?:please )?move (?:the )?selected (?:objects?|design|lettering) (\d+(?:\.\d+)?)\s*(mm|cm|inches|inch|in) (?:to the )?(right|left|up|down)$/);
 if(move){const n=Number(move[1])*(move[2]==='mm'?1:move[2]==='cm'?10:25.4);if(n<=0||n>500)return null;return {kind:'moveSelected',dx:move[3]==='right'?n:move[3]==='left'?-n:0,dy:move[3]==='down'?n:move[3]==='up'?-n:0};}
 const scaleSelected=s.match(/^(?:please )?(?:scale|resize) (?:the )?selected (?:objects?|design|lettering) to (\d+(?:\.\d+)?)\s*(?:%|percent)$/);
 if(scaleSelected){const n=Number(scaleSelected[1]);return n>=10&&n<=300?{kind:'scaleSelected',value:n/100}:null}
 const relativeSelected=s.match(/^(?:please )?make (?:the )?selected (?:objects?|design|lettering) (\d+(?:\.\d+)?)\s*(?:%|percent) (larger|smaller)$/);
 if(relativeSelected){const n=Number(relativeSelected[1]);const scale=1+(relativeSelected[2]==='larger'?n:-n)/100;return n>0&&scale>=.1&&scale<=3?{kind:'scaleSelected',value:scale}:null}
 const rotateSelected=s.match(/^(?:please )?rotate (?:the )?selected (?:objects?|design|lettering)(?: by)? (-?\d+(?:\.\d+)?)\s*(?:degrees?|°)?(?: (clockwise|counterclockwise))?$/);
 if(rotateSelected){const n=Number(rotateSelected[1]);return Math.abs(n)<=360?{kind:'rotateSelected',value:rotateSelected[2]==='counterclockwise'?-Math.abs(n):n}:null}
 const selectedColor=s.match(/^select (?:all )?(?:objects (?:with color|colored) |color )?(.{1,24}?)(?: objects)?$/);
 const rgb = selectedColor ? parseColor(selectedColor[1]) : undefined;
 if (rgb) return {kind:'selectColor',color:rgb};
 const selectedLabel=s.match(/^(?:please )?select (?:all )?objects (?:named|matching) "([^"]+)"$/);
 if(selectedLabel)return {kind:'selectLabel',text:selectedLabel[1]};
 const selectedKind=s.match(/^(?:please )?select (?:all )?(fill|satin|run|manual) (?:objects|stitches)$/);
 if(selectedKind)return {kind:'selectKind',text:selectedKind[1]};
 if(/^(?:please )?(?:clear (?:the )?selection|deselect all)$/.test(s))return {kind:'clearSelection'};
 if(/^(?:please )?(?:(?:optimize|optimise) (?:this |the )?design|reduce (?:the )?(?:stitch count|stitch density|unnecessary stitches)(?: without losing detail)?)$/.test(s))return {kind:'optimize'};
 if(/^(?:please )?(?:review|analyze|analyse|evaluate)(?: (?:this |the )?design)?$/.test(s))return {kind:'review'};
 if(/^(?:please )?(?:recommend|suggest|choose|find)(?: (?:the |a |best )?)(?: compatible)?hoop(?: for (?:this |the |my )?design)?$/.test(s))return {kind:'recommendHoop'};
 if(/^(?:please )?(?:optimize|optimise|prepare|set up)(?: (?:the |this |my )?design| it)? for (?:a |an )?(standard|cotton|twill|denim|canvas|polyester|t-shirt|jersey|sweatshirt|stretch|fleece|towel|hat|leather|knit|thin-cap|structured-cap)$/.test(s)){
  return {kind:'fabric',fabric:s.split(' ').at(-1)};
 }
 const recolor = s.match(/^(?:replace|change|swap) (.{1,35}?) (?:with|to|for) (.{1,35})$/);
 if (recolor) {
   const previous = parseColor(recolor[1]), color = parseColor(recolor[2]);
   if (previous && color) return {kind:'recolor',previous,color};
 }
 if(/^(?:how (?:do|can) i |what is |explain )(?:(?:use |choose |select )?)(?:underlay|density|pull compensation|satin stitches|stabilizer|thread trims)$/.test(s))return {kind:'help'};
 if(/^(?:please )?(?:center|centre)(?: (?:this |the |my )?design| it)?(?: in (?:the |my )?hoop)?$/.test(s))return {kind:'center'};
 if(/^(?:please )?(?:resize|scale|fit)(?: (?:this |the )?design)?(?: to fit| to)? (?:the |my )?(?:selected )?hoop$/.test(s))return {kind:'fit'};
 if(/^(?:please )?(?:check|audit|inspect)(?: (?:the |this )?(?:design|stitch quality|stitches))?$/.test(s))return {kind:'audit'};
 if(/^(?:please )?undo(?: (?:the )?last (?:change|edit))?$/.test(s))return {kind:'undo'};
 if(/^(?:please )?redo$/.test(s))return {kind:'redo'};
 const rotate=s.match(/^(?:please )?rotate(?: (?:the |this )?design)?(?: by)? (-?\d+(?:\.\d+)?)\s*(?:degrees?|°)?(?: (clockwise|counterclockwise))?$/);
 if(rotate){const n=Number(rotate[1]);if(Number.isFinite(n)&&Math.abs(n)<=360)return {kind:'rotate',value:rotate[2]==='counterclockwise'?-Math.abs(n):n};}
 const resize=s.match(/^(?:please )?(?:resize|scale)(?: (?:the |this )?design)? to (\d+(?:\.\d+)?)\s*(?:%|percent)$/);
 if(resize){const n=Number(resize[1]);if(n>=10&&n<=300)return {kind:'scale',value:n/100};}
 if(/^(?:please )?(?:flip|mirror)(?: (?:the |this )?design)? horizontally$/.test(s))return {kind:'flipH'};
 if(/^(?:please )?(?:flip|mirror)(?: (?:the |this )?design)? vertically$/.test(s))return {kind:'flipV'};
 return null;
}
