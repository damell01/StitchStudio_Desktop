import {parseMotifRequest} from './assistant-motif-intent';
import type {AssistantIntent} from './assistant-intent';
import {motifColor} from './assistant-motif';

export function compositionPrompt(input: string) {
  return /^(?:please )?(?:(?:can|could|would) you )?(?:create|make|build|design|compose) (?:me )?(?:(?:a|an|the|new) )?(?:(?:\d+(?:\.\d+)?\s*[- ]?(?:inches|inch|in|cm|mm) )?(?:embroidery |name |appliqu[eé] )?(?:design|patch|badge|nameplate|monogram|appliqu[eé]))\b/i.test(input.trim());
}

type Composition = {
  text?: string;
  textColor: number[];
  width?: number;
  frame?: {style: 'round'|'oval'|'rounded'|'scalloped'; color: number[]};
  accents: AssistantIntent[];
};

export function parseComposition(input: string): Composition | string {
  const normalized = input.trim().replace(/[“”]/g,'"').replace(/[.!?]+$/,'');
  const match = normalized.match(/^(?:please )?(?:(?:can|could|would) you )?(?:create|make|build|design|compose) (?:me )?(?:(?:a|an|the|new) )?(?:(\d+(?:\.\d+)?)\s*[- ]?(mm|cm|inches|inch|in) )?(?:embroidery |name |appliqu[eé] )?(design|patch|badge|nameplate|monogram|appliqu[eé])(?: (?:using|with|featuring) (.*)| ?:(.*))?$/iu);
  const example = 'Try “Create a 4-inch patch with \"Little Seed\", a lavender bow above it, and a scalloped border”.';
  if (!match?.[4] && !match?.[5]) return example;
  const body = (match[4] ?? match[5]).trim();
  const width = match[1] ? Number(match[1]) * (match[2].toLowerCase()==='cm' ? 10 : match[2].toLowerCase()==='mm' ? 1 : 25.4) : undefined;
  if (width !== undefined && (width < 25 || width > 300)) return 'Choose a design width between 25 and 300 mm.';
  const usesPatchFrame = /^(?:patch|badge|nameplate)$/i.test(match[3]);
  const defaultColor = [105,69,162];
  const result: Composition = {width,textColor:defaultColor,
    frame:usesPatchFrame ? {style:'rounded',color:defaultColor} : undefined,accents:[]};
  const parts = body.match(/"[^"]*"|[^"]+/g) ?? [];
  // Keep punctuation and conjunctions inside quoted lettering intact.
  const split = parts.map(part=>part.startsWith('"') ? '\u0001' : part).join('')
    .split(/\s*,\s*(?:and\s+)?|\s+and\s+(?!(?:right|left)\b)/i).map(part=>part.trim()).filter(Boolean);
  const quoted = parts.filter(part=>part.startsWith('"'));
  if (quoted.length > 1) return 'Use one quoted lettering block per design.';
  for (const part of split) {
    if (part.includes('\u0001')) {
      const lettering = part.match(/^(?:the )?(?:([a-z ]+?) )?(?:(?:text|lettering|name) )?\u0001(?: (?:in the center|centered))?$/i);
      if (!lettering || (lettering[1] && !motifColor(lettering[1]) && !/^(?:text|lettering|name)$/i.test(lettering[1]))) return example;
      const text = quoted[0].slice(1,-1).trim();
      if (!text || Array.from(text).length > 120) return 'Use 1–120 characters of lettering.';
      result.text = text;
      result.textColor = motifColor(lettering[1] ?? '') ?? defaultColor;
      continue;
    }
    const frame = part.match(/^(?:a |an |the )?(.*?)(?:\b(border|frame|outline))$/i);
    if (frame) {
      const words = frame[1].trim().toLowerCase().split(' ').filter(Boolean);
      const types = new Map<string, NonNullable<Composition['frame']>['style']>([['round','round'],['circular','round'],['circle','round'],['oval','oval'],['rounded','rounded'],['rectangular','rounded'],['scalloped','scalloped']]);
      const style = types.get(words.at(-1) ?? '');
      const colorText = (style ? words.slice(0,-1) : words).join(' ');
      const color = colorText ? motifColor(colorText) : defaultColor;
      if (!color) return 'Choose a round, oval, rounded, or scalloped border with a named thread color.';
      result.frame = {style:style ?? 'rounded',color};
      continue;
    }
    const accent = parseMotifRequest('Add '+part);
    if (!accent) return example;
    result.accents.push(accent);
    if (result.accents.length > 6) return 'Use up to six motif requests per design.';
  }
  if (!result.text && !result.accents.length) return example;
  return result;
}
