export type PricingRates={garment:number;supplies:number;threadPerThousand:number;machineHourly:number;laborHourly:number;handlingMinutes:number;setupFee:number;digitizingFee:number;margin:number;minimum:number;shipping:number;tax:number;wastePercent:number};
export type QuoteInput=PricingRates&{quantity:number;stitches:number;minutes:number};
export const defaultRates:PricingRates={garment:5,supplies:.75,threadPerThousand:.12,machineHourly:12,laborHourly:20,handlingMinutes:4,setupFee:0,digitizingFee:0,margin:40,minimum:0,shipping:0,tax:0,wastePercent:5};
export function calculateQuote(i:QuoteInput){
 const safe=(v:number)=>Number.isFinite(v)?Math.max(0,v):0;
 const q=Math.max(1,Math.min(100000,Math.floor(safe(i.quantity))));
 const material=safe(i.garment)+safe(i.supplies)+safe(i.stitches)/1000*safe(i.threadPerThousand);
 const waste=material*safe(i.wastePercent)/100;
 const machine=safe(i.minutes)/60*safe(i.machineHourly);
 const labor=(safe(i.minutes)+safe(i.handlingMinutes))/60*safe(i.laborHourly);
 const unitCost=material+waste+machine+labor;
 const production=unitCost*q;
 const fees=safe(i.setupFee)+safe(i.digitizingFee);
 const margin=Math.min(95,safe(i.margin))/100;
 // Setup/digitizing are quoted charges, not assumed production expenses.
 const unitPrice=Math.ceil(Math.max(safe(i.minimum),unitCost/(1-margin))*100-1e-8)/100;
 const subtotal=unitPrice*q+fees+safe(i.shipping);
 const tax=Math.round(subtotal*Math.min(100,safe(i.tax)))/100;
 const total=Math.round((subtotal+tax)*100)/100;
 return {q,material,waste,machine,labor,unitCost,production,fees,unitPrice,subtotal,tax,total,productionProfit:unitPrice*q-production,productionMargin:unitPrice>0?(unitPrice-unitCost)/unitPrice*100:0,productionMinutes:q*(safe(i.minutes)+safe(i.handlingMinutes))};
}
