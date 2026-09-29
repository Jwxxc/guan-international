/** Owner capability comes only from a local launcher fragment, never the network. */
export const LEARNING_PREFIX='/api/jwxxc-beta';
const OWNER_KEY='guan.learning.owner.v1';
let consent=false;
const tabId=globalThis.crypto?.randomUUID?.()??String(Date.now());
export const LEARNING_CHANGED='guan-learning-changed';
export function claimLearningOwner():void {
 if(typeof location==='undefined'||!['127.0.0.1','localhost','[::1]'].includes(location.hostname))return;
 const fragment=new URLSearchParams(location.hash.slice(1)),cap=fragment.get('learning-owner');
 if(!cap)return;
 // Strip even a malformed fragment before another navigation/copy can propagate it.
 history.replaceState(history.state,'',location.pathname+location.search);
 if(/^[a-f0-9]{64}$/.test(cap))try{localStorage.setItem(OWNER_KEY,cap);}catch{/* Session can play without owner storage. */}
}
export function learningOwner():string|null {claimLearningOwner();try{return localStorage.getItem(OWNER_KEY);}catch{return null;}}
export function learningConsented(){return consent;}
export function setLearningConsent(value:boolean){consent=value;window.dispatchEvent(new Event(LEARNING_CHANGED));}
export async function learningRequest<T=Record<string,unknown>>(route:string,body:unknown={}):Promise<T>{
 const capability=learningOwner();if(!capability)throw Error('请先双击项目中的“开启 GUAN 自动学习.command”，验证本机管理权限。');
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
 try{
  const response=await fetch(LEARNING_PREFIX+route,{method:'POST',credentials:'same-origin',cache:'no-store',signal:abort.signal,headers:{'Content-Type':'application/json',Authorization:`Bearer ${capability}`},body:JSON.stringify(body)});
  const data=await response.json();if(!response.ok)throw Error(data.error??data.reason??`学习服务 ${response.status}`);return data as T;
 }finally{clearTimeout(timer);}
}
const latencies:Array<{at:number;value:number}>=[];let inferencePending=0;
export function trackLearningInference(){inferencePending++;void learningActivity(true);let finished=false;return(elapsedMs?:number)=>{if(finished)return;finished=true;inferencePending=Math.max(0,inferencePending-1);void learningActivity(true,elapsedMs);};}
export async function learningActivity(playing:boolean,latencyMs?:number){while(latencies.length&&Date.now()-latencies[0]!.at>30000)latencies.shift();if(latencyMs!==undefined){latencies.push({at:Date.now(),value:latencyMs});if(latencies.length>40)latencies.shift();}const p95=latencies.length?latencies.map(sample=>sample.value).sort((a,b)=>a-b)[Math.min(latencies.length-1,Math.ceil(latencies.length*.95)-1)]:undefined;if(!learningOwner())return;try{await learningRequest('/activity',{active:playing,inferenceP95Ms:p95,queueDepth:inferencePending,tabId});}catch{/* Training cannot block a game. */}}
