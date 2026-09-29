/** Presentation tiers follow the actual card width, not device names. */
export type CardDetail = 'large' | 'medium' | 'small' | 'tiny';
export function cardDetailForWidth(width: number): CardDetail {
  return width >= 84 ? 'large' : width >= 68 ? 'medium' : width >= 54 ? 'small' : 'tiny';
}
export interface PublicPile { position: 'top'|'right'|'bottom'|'left'; count: number; current: boolean; wild: boolean; hasAction: boolean }
export interface PublicPileLayout { width:number;height:number;step:number;slotWidth:number;x:number;y:number;bottom:boolean;compact:boolean;detail:CardDetail }
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
/** Four non-overlapping ownership columns; top/bottom share a measured height budget. */
export function publicPileLayouts(arenaWidth:number,arenaHeight:number,piles:PublicPile[]):PublicPileLayout[] {
  const w=Math.max(400,arenaWidth),h=Math.max(180,arenaHeight),top=76,bottom=14,gap=12;
  const centerLeft=w*.36,centerWidth=w*.28,seatInset=w<1100?100:112;
  const sideWidth=Math.max(120,centerLeft-gap-seatInset);
  const centers=piles.filter(p=>p.position==='top'||p.position==='bottom');
  const both=centers.filter(p=>p.count>0).length===2;
  const cramped=both&&(h<(centers.some(p=>p.wild)?432:360));
  const compact=(p:PublicPile)=>cramped&&!p.current&&p.count>0&&(p.position==='top'||p.position==='bottom');
  return piles.map(p=>{
    const center=p.position==='top'||p.position==='bottom',other=centers.find(c=>c.position!==p.position);
    const text=p.wild?68:44;
    let panelBudget=h-110;
    if(center){
      panelBudget=both&&!cramped?(h-top-bottom-gap)/2:h-top-bottom-(other?.hasAction?52:0)-gap;
      if(compact(p))panelBudget=48;
    }
    const ideal=clamp(Math.floor(h*.16+16),60,96);
    const maxWidth=Math.floor(Math.min(ideal*(p.current?1:.88),(panelBudget-text)/1.5));
    const slotWidth=Math.floor(center?centerWidth:sideWidth);
    let width=clamp(maxWidth,48,96),step=width;
    for(let candidate=width;candidate>=48;candidate--){
      const minimum=candidate>=84?30:candidate>=68?25:candidate>=54?22:20;
      const proposed=p.count<=1?candidate:Math.min(Math.round(candidate*.6),Math.floor((slotWidth-candidate)/(p.count-1)));
      if(proposed>=minimum||p.count<=1){width=candidate;step=proposed;break;}
      if(candidate===48){width=48;step=Math.max(18,Math.floor((slotWidth-48)/Math.max(1,p.count-1)));}
    }
    const height=Math.round(width*1.5),block=height+text;
    const y=center?(p.position==='top'?top:bottom):clamp(h*.55,72+block/2,h-bottom-block/2);
    return{width,height,step,slotWidth,x:center?w/2:p.position==='left'?seatInset+sideWidth/2:w-seatInset-sideWidth/2,y,bottom:p.position==='bottom',compact:compact(p),detail:cardDetailForWidth(width)};
  });
}
