import {ACTION_DIM,HISTORY_DIM,HISTORY_LIMIT,STATE_DIM,type EncodedObservation} from './encoding';

export interface ModelWeights {
  schemaVersion:string;
  config:{state_dim:number;history_dim:number;action_dim:number;width:number;heads:number;layers:number;ff_width:number;history_limit:number;event_classes:number;layer_norm_eps:number};
  weights:Record<string,number[]|number[][]>;
}
const relu=(x:number[])=>x.map(n=>Math.max(0,n));
const add=(a:number[],b:number[])=>a.map((v,i)=>v+b[i]);

/** Original inference implementation; no third-party checkpoint deserialization. */
export class ProNetwork {
  readonly config:ModelWeights['config'];
  constructor(private readonly artifact:ModelWeights){
    const c=this.config=artifact.config;
    if(artifact.schemaVersion!=='guan-pro-weights-v1'||c.state_dim!==STATE_DIM||c.history_dim!==HISTORY_DIM||c.action_dim!==ACTION_DIM||c.history_limit!==HISTORY_LIMIT||c.width<4||c.width>128||c.heads<1||c.width%c.heads||c.layers<1||c.layers>4||c.layer_norm_eps!==1e-5)throw Error('PRO model/encoder incompatibility');
    const vector=(name:string,n:number)=>{const x=artifact.weights[name];if(!Array.isArray(x)||x.length!==n||x.some(v=>typeof v!=='number'||!Number.isFinite(v)))throw Error('PRO invalid tensor '+name);};
    const matrix=(name:string,rows:number,cols:number)=>{const x=artifact.weights[name];if(!Array.isArray(x)||x.length!==rows||x.some(row=>!Array.isArray(row)||row.length!==cols||row.some(v=>typeof v!=='number'||!Number.isFinite(v))))throw Error('PRO invalid tensor '+name);};
    const linear=(name:string,out:number,input:number)=>{matrix(name+'.weight',out,input);vector(name+'.bias',out);};
    const norm=(name:string)=>{vector(name+'.weight',c.width);vector(name+'.bias',c.width);};
    matrix('position',HISTORY_LIMIT,c.width);linear('historyIn',c.width,HISTORY_DIM);norm('historyNorm');
    linear('state1',c.width,STATE_DIM);linear('state2',c.width,c.width);linear('action1',c.width,ACTION_DIM);linear('action2',c.width,c.width);
    linear('q1',c.width,c.width*3);linear('q2',1,c.width);linear('v1',c.width,c.width*2);linear('v2',1,c.width);linear('eventHead',c.event_classes,c.width*2);
    for(let i=0;i<c.layers;i++){const p=`layers.${i}.`;norm(p+'norm1');norm(p+'norm2');for(const name of ['q','k','v','o'])linear(p+name,c.width,c.width);linear(p+'ff1',c.ff_width,c.width);linear(p+'ff2',c.width,c.ff_width);}
  }
  private linear(name:string,x:number[]):number[]{
    const w=this.artifact.weights[name+'.weight'] as number[][],b=this.artifact.weights[name+'.bias'] as number[];
    return w.map((row,i)=>{let v=b[i];for(let j=0;j<row.length;j++)v+=row[j]*x[j];return v;});
  }
  private norm(name:string,x:number[]):number[]{
    const w=this.artifact.weights[name+'.weight'] as number[],b=this.artifact.weights[name+'.bias'] as number[];
    const mean=x.reduce((a,n)=>a+n,0)/x.length,variance=x.reduce((a,n)=>a+(n-mean)**2,0)/x.length,denom=Math.sqrt(variance+this.config.layer_norm_eps);
    return x.map((v,i)=>(v-mean)/denom*w[i]+b[i]);
  }
  encode(input:EncodedObservation):number[]{
    if(input.state.length!==STATE_DIM||input.history.length<1||input.history.length>HISTORY_LIMIT||input.history.some(row=>row.length!==HISTORY_DIM))throw Error('PRO invalid feature shape');
    const c=this.config,positions=this.artifact.weights.position as number[][],headWidth=c.width/c.heads;
    let x=input.history.map((row,i)=>add(this.linear('historyIn',row),positions[i]));
    for(let layer=0;layer<c.layers;layer++){
      const p=`layers.${layer}.`,norm=x.map(row=>this.norm(p+'norm1',row));
      const queries=norm.map(row=>this.linear(p+'q',row)),keys=norm.map(row=>this.linear(p+'k',row)),values=norm.map(row=>this.linear(p+'v',row));
      x=x.map((row,t)=>{
        const attended=Array<number>(c.width).fill(0);
        for(let head=0;head<c.heads;head++){
          const offset=head*headWidth,logits=[];let max=-Infinity;
          for(let s=0;s<=t;s++){let dot=0;for(let j=0;j<headWidth;j++)dot+=queries[t][offset+j]*keys[s][offset+j];const v=dot/Math.sqrt(headWidth);logits.push(v);max=Math.max(max,v);}
          const probs=logits.map(v=>Math.exp(v-max)),sum=probs.reduce((a,v)=>a+v,0);
          for(let s=0;s<=t;s++)for(let j=0;j<headWidth;j++)attended[offset+j]+=probs[s]/sum*values[s][offset+j];
        }
        const residual=add(row,this.linear(p+'o',attended));
        return add(residual,this.linear(p+'ff2',relu(this.linear(p+'ff1',this.norm(p+'norm2',residual)))));
      });
    }
    return [...this.norm('historyNorm',x.at(-1)!),...relu(this.linear('state2',relu(this.linear('state1',input.state))))];
  }
  score(context:number[],actions:number[][]):number[]{
    return actions.map(action=>{if(action.length!==ACTION_DIM)throw Error('PRO invalid action shape');const a=relu(this.linear('action2',relu(this.linear('action1',action))));return this.linear('q2',relu(this.linear('q1',[...context,...a])))[0];});
  }
  value(context:number[]):number{return this.linear('v2',relu(this.linear('v1',context)))[0];}
  nextEvent(context:number[]):number[]{return this.linear('eventHead',context);}
}
