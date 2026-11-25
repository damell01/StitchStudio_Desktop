export type PricingRates={garment:number;supplies:number;threadPerThousand:number;machineHourly:number;laborHourly:number;handlingMinutes:number;setupFee:number;digitizingFee:number;margin:number;minimum:number;shipping:number;tax:number;wastePercent:number};
export type QuoteInput=PricingRates&{quantity:number;stitches:number;minutes:number;method?:'cost'|'stitch';stitchRate?:number;extraMaterial?:number;extraHandling?:number;priceOverride?:number;garmentMarkup?:number;specialtyMinimum?:number;customerProvided?:boolean;providedHandling?:number};
export const defaultRates:PricingRates={garment:6,supplies:1,threadPerThousand:.15,machineHourly:8,laborHourly:20,handlingMinutes:4,setupFee:0,digitizingFee:0,margin:40,minimum:15,shipping:0,tax:0,wastePercent:5};
export function calculateQuote(i:QuoteInput){
 const safe=(v:number)=>Number.isFinite(v)?Math.max(0,v):0;
 const q=Math.max(1,Math.min(100000,Math.floor(safe(i.quantity))));
 const garment=i.customerProvided?0:safe(i.garment);
 const handling=safe(i.handlingMinutes)+safe(i.extraHandling??0)+(i.customerProvided?safe(i.providedHandling??0):0);
 const material=garment+safe(i.supplies)+safe(i.extraMaterial??0)+safe(i.stitches)/1000*safe(i.threadPerThousand);
 const waste=material*safe(i.wastePercent)/100;
 const machine=safe(i.minutes)/60*safe(i.machineHourly);
 const labor=(safe(i.minutes)+handling)/60*safe(i.laborHourly);
 const unitCost=material+waste+machine+labor;
 const production=unitCost*q;
 const fees=safe(i.setupFee)+safe(i.digitizingFee);
 const margin=Math.min(95,safe(i.margin))/100;
 // Setup/digitizing are quoted charges, not assumed production expenses.
 const garmentRetail=garment*(1+safe(i.garmentMarkup??50)/100);
 const embroideryMinimum=Math.max(safe(i.minimum),safe(i.specialtyMinimum??0));
 const suggestedPrice=Math.ceil(Math.max(embroideryMinimum+garmentRetail,unitCost/(1-margin))*2-1e-8)/2;
 const stitchPrice=Math.ceil((Math.max(embroideryMinimum,safe(i.stitches)/1000*safe(i.stitchRate??1.75)+safe(i.extraMaterial??0)+safe(i.extraHandling??0)/60*safe(i.laborHourly))+garmentRetail)*100-1e-8)/100;
 const unitPrice=i.priceOverride!==undefined?safe(i.priceOverride):i.method==='stitch'?stitchPrice:suggestedPrice;
 const subtotal=unitPrice*q+fees+safe(i.shipping);
 const tax=Math.round(subtotal*Math.min(100,safe(i.tax)))/100;
 const total=Math.round((subtotal+tax)*100)/100;
 return {suggestedPrice,stitchPrice,garmentRetail,garmentCost:garment,q,material,waste,machine,labor,unitCost,production,fees,unitPrice,subtotal,tax,total,productionProfit:unitPrice*q-production,productionMargin:unitPrice>0?(unitPrice-unitCost)/unitPrice*100:0,productionMinutes:q*(safe(i.minutes)+safe(i.handlingMinutes)+safe(i.extraHandling??0))};
}

export const jobTypes={
 standard:{minimum:15,label:'Regular embroidery',material:0,handling:0,materialLabel:'Additional materials'},
 applique:{minimum:18,label:'Appliqué',material:1.5,handling:5,materialLabel:'Appliqué fabric & adhesive'},
 puff:{minimum:18,label:'3D puff',material:1,handling:3,materialLabel:'Embroidery foam'},
 monogram:{minimum:15,label:'Monogramming',material:0,handling:2,materialLabel:'Personalization supplies'},
 patch:{minimum:15,label:'Patches',material:1.5,handling:5,materialLabel:'Patch backing & border supplies'},
 ith:{minimum:18,label:'In-the-hoop project',material:2,handling:8,materialLabel:'Assembly materials'},
 lace:{minimum:18,label:'Freestanding lace',material:1.5,handling:5,materialLabel:'Water-soluble stabilizer & finishing supplies'},
 hat:{minimum:15,label:'Embroidered hats',material:0,handling:4,materialLabel:'Cap-specific supplies'}
} as const;
export type JobType=keyof typeof jobTypes;
export function suggestJobType(objects:{kind:string;label?:string;groups?:string[]}[],name=''):{type:JobType;reason:string}{
 const kinds=objects.map(o=>o.kind.toLowerCase());
 const tags=objects.flatMap(o=>o.groups??[]).join(' ').toLowerCase();
 const hints=(name+' '+objects.map(o=>o.label??'').join(' ')+' '+tags).toLowerCase();
 if(kinds.includes('applique')||/appliqu[eé]/i.test(hints))return {type:'applique',reason:'Appliqué stitch objects or design labels detected.'};
 for(const [pattern,type] of [[/\b(?:3d[ -]?puff|foam embroidery)\b/,'puff'],[/\b(?:freestanding lace|fsl)\b/,'lace'],[/\b(?:in.the.hoop|ith)\b/,'ith'],[/\bpatch(?:es)?\b/,'patch'],[/\bmonogram(?:ming)?\b/,'monogram'],[/\b(?:hat|cap)(?:s)?\b/,'hat']] as [RegExp,JobType][])if(pattern.test(hints))return {type,reason:'Suggested from the design name or object labels; confirm the job type.'};
 return {type:'standard',reason:'No specialty job type identified. Change if needed.'};
}
