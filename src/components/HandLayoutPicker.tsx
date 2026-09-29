import { tx } from '../i18n';
import type { HandLayout } from '../hand/arrangement';
const layouts: Array<[HandLayout, string]> = [['single','单排'],['double','双排'],['vertical','竖排']];
/** Display-only cycle: vertical → single → double → vertical. */
export function HandLayoutPicker({layout,onChange}:{layout:HandLayout;onChange:(layout:HandLayout)=>void}) {
  const index=layouts.findIndex(([value])=>value===layout),next=layouts[(index+1)%layouts.length]!;
  return <div className="hand-view-controls"><button type="button" className="hand-layout-trigger" data-testid="hand-layout-trigger" aria-label={tx(`布局：${layouts[index]![1]}`)} title={tx(`点击切换为${next[1]}`)} onMouseDown={event=>{event.preventDefault();event.currentTarget.focus();}} onClick={()=>onChange(next[0])}><span className={`hand-layout-icon hand-layout-${layout}`} aria-hidden="true"><i/><i/><i/></span><span>{tx(layouts[index]![1])}</span></button></div>;
}
