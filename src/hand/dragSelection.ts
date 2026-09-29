export interface Point { x: number; y: number }
export interface CardRegion { id: string; left: number; top: number; right: number; bottom: number }

/** Remove occluded card faces, including the overlap between rows or stacks. */
export function visibleCardRegions(cards: CardRegion[]): CardRegion[] {
  return cards.flatMap((card, index) => {
    let pieces = [card];
    for (const cover of cards.slice(index + 1)) {
      pieces = pieces.flatMap(piece => {
        const left = Math.max(piece.left, cover.left), right = Math.min(piece.right, cover.right);
        const top = Math.max(piece.top, cover.top), bottom = Math.min(piece.bottom, cover.bottom);
        if (left >= right || top >= bottom) return [piece];
        return [
          { ...piece, bottom: top }, { ...piece, top: bottom },
          { ...piece, top, bottom, right: left }, { ...piece, top, bottom, left: right },
        ].filter(part => part.right > part.left && part.bottom > part.top);
      });
    }
    return pieces;
  });
}

function intersects(region: CardRegion, start: Point, end: Point): boolean {
  let near = 0, far = 1;
  for (const [origin, delta, min, max] of [
    [start.x, end.x - start.x, region.left, region.right - .01],
    [start.y, end.y - start.y, region.top, region.bottom - .01],
  ]) {
    if (Math.abs(delta) < 1e-8) { if (origin < min || origin > max) return false; continue; }
    const a = (min - origin) / delta, b = (max - origin) / delta;
    near = Math.max(near, Math.min(a,b)); far = Math.min(far, Math.max(a,b));
    if (near > far) return false;
  }
  return true;
}

/** Segment intersection avoids losing cards when the browser coalesces fast moves. */
export function crossedCards(regions: CardRegion[], start: Point, end: Point): string[] {
  return [...new Set(regions.filter(region => intersects(region, start, end)).map(region => region.id))];
}

export function paintedSelection(initial: string[], touched: ReadonlySet<string>, selecting: boolean, available: ReadonlySet<string>): string[] {
  const result = new Set(initial.filter(id => available.has(id)));
  for (const id of touched) {
    if (!available.has(id)) continue;
    if (selecting) result.add(id); else result.delete(id);
  }
  return [...result];
}
