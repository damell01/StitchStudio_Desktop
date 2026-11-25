export function assistantIntent(input:string):{kind:string;value?:number;fabric?:string;previous?:number[];color?:number[];text?:string;size?:number;dx?:number;dy?:number}|null {
 if(input.length>160)return null;
 // Quoted lettering is data, not an instruction. Preserve capitalization.
 const lettering=input.trim().match(/^(?:please )?(?:add|insert) (?:text|lettering) "([^"\r\n]+)"(?: (?:at|size) (\d+(?:\.\d+)?)\s*mm)?[.!]?$/i);
 if(lettering){const size=Number(lettering[2]??12);if(lettering[1].trim()&&Array.from(lettering[1]).length<=120&&size>=3&&size<=80)return {kind:'lettering',text:lettering[1],size};return null}
 const s=input.trim().toLowerCase().replace(/[.!?]+$/,'').replace(/\s+/g,' ');
 const move=s.match(/^(?:please )?move (?:the )?selected (?:objects?|design|lettering) (\d+(?:\.\d+)?)\s*(mm|cm|inches|inch|in) (?:to the )?(right|left|up|down)$/);
 if(move){const n=Number(move[1])*(move[2]==='mm'?1:move[2]==='cm'?10:25.4);if(n<=0||n>500)return null;return {kind:'moveSelected',dx:move[3]==='right'?n:move[3]==='left'?-n:0,dy:move[3]==='down'?n:move[3]==='up'?-n:0};}
 const scaleSelected=s.match(/^(?:please )?(?:scale|resize) (?:the )?selected (?:objects?|design|lettering) to (\d+(?:\.\d+)?)\s*(?:%|percent)$/);
 if(scaleSelected){const n=Number(scaleSelected[1]);return n>=10&&n<=300?{kind:'scaleSelected',value:n/100}:null}
 const relativeSelected=s.match(/^(?:please )?make (?:the )?selected (?:objects?|design|lettering) (\d+(?:\.\d+)?)\s*(?:%|percent) (larger|smaller)$/);
 if(relativeSelected){const n=Number(relativeSelected[1]);const scale=1+(relativeSelected[2]==='larger'?n:-n)/100;return n>0&&scale>=.1&&scale<=3?{kind:'scaleSelected',value:scale}:null}
 const rotateSelected=s.match(/^(?:please )?rotate (?:the )?selected (?:objects?|design|lettering)(?: by)? (-?\d+(?:\.\d+)?)\s*(?:degrees?|°)?(?: (clockwise|counterclockwise))?$/);
 if(rotateSelected){const n=Number(rotateSelected[1]);return Math.abs(n)<=360?{kind:'rotateSelected',value:rotateSelected[2]==='counterclockwise'?-Math.abs(n):n}:null}
 const selectedColor=s.match(/^(?:please )?select (?:all )?(?:objects (?:with color|colored) |color )?(#[0-9a-f]{6})(?: objects)?$/);
 if(selectedColor)return {kind:'selectColor',color:[1,3,5].map(i=>parseInt(selectedColor[1].slice(i,i+2),16))};
 const selectedLabel=s.match(/^(?:please )?select (?:all )?objects (?:named|matching) "([^"]+)"$/);
 if(selectedLabel)return {kind:'selectLabel',text:selectedLabel[1]};
 const selectedKind=s.match(/^(?:please )?select (?:all )?(fill|satin|run|manual) (?:objects|stitches)$/);
 if(selectedKind)return {kind:'selectKind',text:selectedKind[1]};
 if(/^(?:please )?(?:clear (?:the )?selection|deselect all)$/.test(s))return {kind:'clearSelection'};
 if(/^(?:please )?(?:(?:optimize|optimise) (?:this |the )?design|reduce (?:the )?(?:stitch count|stitch density|unnecessary stitches)(?: without losing detail)?)$/.test(s))return {kind:'optimize'};
 if(/^(?:please )?(?:review|analyze|analyse|evaluate)(?: (?:this |the )?design)?$/.test(s))return {kind:'review'};
 if(/^(?:please )?(?:recommend|suggest|choose|find)(?: (?:the |a |best )?)(?: compatible)?hoop(?: for (?:this |the |my )?design)?$/.test(s))return {kind:'recommendHoop'};
 if(/^(?:please )?(?:optimize|optimise|prepare)(?: (?:the |this )?design)? for (?:a |an )?(standard|cotton|twill|denim|canvas|polyester|t-shirt|jersey|sweatshirt|stretch|fleece|towel|hat|leather|knit|thin-cap|structured-cap)$/.test(s)){
  return {kind:'fabric',fabric:s.split(' ').at(-1)};
 }
 const recolor=s.match(/^(?:please )?(?:replace|change) (#[0-9a-f]{6}) (?:with|to) (#[0-9a-f]{6})$/);
 if(recolor){const rgb=(h:string)=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16));return {kind:'recolor',previous:rgb(recolor[1]),color:rgb(recolor[2])};}
 if(/^(?:how (?:do|can) i |what is |explain )(?:(?:use |choose |select )?)(?:underlay|density|pull compensation|satin stitches|stabilizer|thread trims)$/.test(s))return {kind:'help'};
 if(/^(?:please )?(?:center|centre)(?: (?:this |the )?design)?(?: in (?:the |my )?hoop)?$/.test(s))return {kind:'center'};
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
