import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

const dimension = /(?:^|[\s_(-])(\d+(?:\.\d+)?|\.\d+)\s*(mm|cm|inch(?:es)?|in\b|["″])/i;

export function compareNames(left: string, right: string): number {
  const first = dimension.exec(left);
  const second = dimension.exec(right);
  const family = (name: string) => name.replace(dimension, '').replace(/[()_-]/g, ' ').trim();
  const group = collator.compare(family(left), family(right));
  if (group) return group;
  const metric = (match: RegExpExecArray | null) => match ? Number(match[1]) *
    (match[2].toLowerCase() === 'mm' ? 1 : match[2].toLowerCase() === 'cm' ? 10 : 25.4) : 0;
  return metric(first) - metric(second) || collator.compare(left, right);
}

export function matchesName(name: string, query: string): boolean {
  const normalized = name.toLocaleLowerCase().replace(/[_-]/g, ' ');
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => normalized.includes(word));
}

export function usePagedList<T>(items: T[], filterKey: string, size = 12) {
  const [position, setPosition] = useState({ filterKey, index: 0 });
  const pages = Math.max(1, Math.ceil(items.length / size));
  const index = position.filterKey === filterKey ? Math.min(pages - 1, position.index) : 0;
  const start = index * size;
  return {
    items: items.slice(start, start + size),
    index, pages, total: items.length, start,
    end: Math.min(items.length, start + size),
    go: (next: number) => setPosition({ filterKey, index: next }),
  };
}

export function ListNavigation({ index, pages, total, start, end, go }: {
  index: number; pages: number; total: number; start: number; end: number; go: (index: number) => void;
}) {
  if (!total) return null;
  return <div className="list-navigation" role="group" aria-label="Result pages">
    <span aria-live="polite">{start + 1}–{end} of {total}</span>
    {pages > 1 && <>
      <button onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous page"><ChevronLeft size={16}/></button>
      <span>Page {index + 1} of {pages}</span>
      <button onClick={() => go(index + 1)} disabled={index + 1 === pages} aria-label="Next page"><ChevronRight size={16}/></button>
    </>}
  </div>;
}
