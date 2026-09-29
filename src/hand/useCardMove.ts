import { useEffect, useRef, useState, type MouseEvent, type PointerEvent, type RefObject } from 'react';
import { movingCardIds, type MoveColumn } from './cardMove';
export const CARD_MOVE_HOLD_MS = 220;
export interface CardMovePreview { cardId: string; cardIds: string[]; x: number; y: number; targetKey: string | null | undefined }
interface Gesture { pointerId:number; cardId:string; cardIds:string[]; key:string; start:{x:number;y:number}; point:{x:number;y:number}; ready:boolean; active:boolean; timer?:number; viewport:[number,number]; bounds:[number,number,number,number] }

/** Long press moves the grabbed card or its selection; quick motion keeps paint selection. */
export function useCardMove({host,columns,selected,layoutKey,enabled,cancelPaint,onMove}:{
  host:RefObject<HTMLDivElement|null>;columns:MoveColumn[];selected:string[];layoutKey:string;enabled:boolean;
  cancelPaint:()=>void;onMove:(cardIds:string[],targetKey:string|null)=>boolean;
}) {
  const latest=useRef({columns,layoutKey,enabled,cancelPaint,onMove});latest.current={columns,layoutKey,enabled,cancelPaint,onMove};
  const current=useRef<Gesture|null>(null),cancelRef=useRef<()=>void>(()=>{});
  const suppressClick=useRef(false),suppressDoubleUntil=useRef(0);
  const [preview,setPreview]=useState<CardMovePreview|null>(null);
  const activateRef=useRef<(gesture:Gesture)=>void>(()=>{});
  useEffect(()=>{
    const element=host.current;let frame=0,lastFrame=0;
    const targetAt=(x:number,y:number):string|null|undefined=>{
      if(!element)return undefined;
      const bounds=element.getBoundingClientRect(),hit=document.elementFromPoint(x,y);
      if(x<bounds.left||x>bounds.right||y<bounds.top||y>bounds.bottom||!hit||!element.contains(hit))return undefined;
      for(const stack of element.querySelectorAll<HTMLElement>('[data-move-target]')){
        const r=stack.getBoundingClientRect(),group=stack.closest('.card-group')!.getBoundingClientRect();
        if(x>=r.left-3&&x<=r.right+3&&y>=group.top)return stack.dataset.moveTarget;
      }
      return null;
    };
    const show=(g:Gesture)=>setPreview({cardId:g.cardId,cardIds:g.cardIds,x:g.point.x,y:g.point.y,targetKey:targetAt(g.point.x,g.point.y)});
    const finish=(render=true,block=false)=>{
      const g=current.current;current.current=null;
      if(g?.timer)window.clearTimeout(g.timer);
      if(frame)cancelAnimationFrame(frame);frame=0;lastFrame=0;
      if(block){suppressClick.current=true;suppressDoubleUntil.current=performance.now()+500;}
      if(g&&element?.hasPointerCapture(g.pointerId))element.releasePointerCapture(g.pointerId);
      if(render)setPreview(null);
    };
    const valid=(g:Gesture)=>{
      const r=element?.getBoundingClientRect();
      // Resize/layout notifications can arrive after pointerup. Check the actual
      // geometry synchronously so old coordinates cannot drop into a new column.
      return latest.current.enabled&&g.key===latest.current.layoutKey&&g.viewport[0]===window.innerWidth&&g.viewport[1]===window.innerHeight&&!!r&&g.bounds.every((value,index)=>Math.abs(value-[r.x,r.y,r.width,r.height][index]!)<.5);
    };
    const tick=(time:number)=>{
      const g=current.current;if(!g?.ready)return;
      if(!valid(g)){finish(true,true);return;}
      const dt=lastFrame?Math.min(32,time-lastFrame):16;lastFrame=time;
      if(g.active&&element){
        const r=element.getBoundingClientRect();
        if(g.point.y>=r.top&&g.point.y<=r.bottom){
          const direction=g.point.x<r.left+28?-Math.min(1,(r.left+28-g.point.x)/28):g.point.x>r.right-28?Math.min(1,(g.point.x-r.right+28)/28):0;
          if(direction){const old=element.scrollLeft;element.scrollLeft+=direction*420*dt/1000;if(element.scrollLeft!==old)show(g);}
        }
      }
      frame=requestAnimationFrame(tick);
    };
    activateRef.current=g=>{
      if(current.current!==g||!valid(g))return;
      latest.current.cancelPaint();g.ready=true;show(g);frame=requestAnimationFrame(tick);
    };
    cancelRef.current=()=>finish(true,Boolean(current.current?.ready||current.current?.active));
    const move=(event:globalThis.PointerEvent)=>{
      const g=current.current;if(!g||event.pointerId!==g.pointerId)return;
      if(!valid(g)||!(event.buttons&1)){finish(true,g.ready);return;}
      g.point={x:event.clientX,y:event.clientY};
      const distance=Math.hypot(g.point.x-g.start.x,g.point.y-g.start.y);
      if(!g.ready){if(distance>=5)finish();return;}
      if(!g.active&&distance>=5){g.active=true;try{element?.setPointerCapture(g.pointerId);}catch{/* Window listeners still finish. */}}
      if(g.active){event.preventDefault();show(g);}
    };
    const up=(event:globalThis.PointerEvent)=>{
      const g=current.current;if(!g||g.pointerId!==event.pointerId)return;
      if(!valid(g)){finish(true,g.ready);return;}
      if(g.ready&&g.active){
        event.preventDefault();const key=targetAt(event.clientX,event.clientY);
        if(key!==undefined)latest.current.onMove(g.cardIds,key);
        finish(true,true);
      }else finish();
    };
    const cancel=()=>cancelRef.current();
    const cancelPointer=(event:globalThis.PointerEvent)=>{if(event.pointerId===current.current?.pointerId)cancel();};
    const hidden=()=>{if(document.hidden)cancel();};
    const scroll=(event:Event)=>{const g=current.current;if(g?.ready&&event.target===element){show(g);return;}cancel();};
    const key=(event:KeyboardEvent)=>{if(current.current){if(event.key==='Escape'){event.preventDefault();event.stopPropagation();}cancel();}};
    window.addEventListener('pointermove',move,{passive:false});window.addEventListener('pointerup',up,{passive:false});window.addEventListener('pointercancel',cancelPointer);
    window.addEventListener('blur',cancel);window.addEventListener('resize',cancel);window.addEventListener('scroll',scroll,true);
    document.addEventListener('keydown',key,true);document.addEventListener('visibilitychange',hidden);
    return()=>{finish(false);cancelRef.current=()=>{};activateRef.current=()=>{};
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancelPointer);window.removeEventListener('blur',cancel);window.removeEventListener('resize',cancel);window.removeEventListener('scroll',scroll,true);document.removeEventListener('keydown',key,true);document.removeEventListener('visibilitychange',hidden);
    };
  },[host]);
  useEffect(()=>cancelRef.current(),[layoutKey,enabled]);
  const onPointerDown=(event:PointerEvent<HTMLDivElement>):boolean=>{
    suppressClick.current=false;
    if(!enabled||event.button!==0||!event.isPrimary)return false;
    const element=event.target instanceof Element?event.target.closest<HTMLElement>('[data-card-id]'):null;
    const id=element?.dataset.cardId;if(!id||!host.current?.contains(element!)||!columns.some(c=>c.cardIds.includes(id)))return false;
    cancelRef.current();
    const r=host.current!.getBoundingClientRect();
    const g:Gesture={viewport:[window.innerWidth,window.innerHeight],bounds:[r.x,r.y,r.width,r.height],pointerId:event.pointerId,cardId:id,cardIds:movingCardIds(columns,selected,id),key:layoutKey,start:{x:event.clientX,y:event.clientY},point:{x:event.clientX,y:event.clientY},ready:false,active:false};current.current=g;
    if(event.altKey){activateRef.current(g);return true;}
    g.timer=window.setTimeout(()=>activateRef.current(g),CARD_MOVE_HOLD_MS);return false;
  };
  const onClickCapture=(event:MouseEvent<HTMLDivElement>)=>{if(event.detail>0&&suppressClick.current){event.preventDefault();event.stopPropagation();suppressClick.current=false;}};
  const onDoubleClickCapture=(event:MouseEvent<HTMLDivElement>)=>{if(performance.now()<suppressDoubleUntil.current){event.preventDefault();event.stopPropagation();}};
  return {preview,onPointerDown,onClickCapture,onDoubleClickCapture,onLostPointerCapture:(event:PointerEvent<HTMLDivElement>)=>{if(event.target===host.current&&current.current?.active)cancelRef.current();}};
}
