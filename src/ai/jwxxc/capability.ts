import {jwxxcModelCapability} from './modelManifest';
import {JWXXC_WORK} from './budgets';

/** Metadata only. Loaded model state is reported by each actual Worker response. */
export function jwxxcCapability(context:{backend:'browser'|'node';mode:'practice'|'classic'|'legacy'}){
 const model=jwxxcModelCapability(),supported=['browser','node'].includes(context.backend)&&['practice','classic','legacy'].includes(context.mode);
 const ready=model.artifactPresent&&model.encoderParityVerified&&model.rulesCompatibilityVerified&&model.informationIsolationVerified;
 const available=supported&&ready;
 return{available,modelTrained:model.artifactPresent,modelReady:ready,strengthVerified:false,searchEnabled:JWXXC_WORK.search.enabled,
  reason:!supported?'当前模式不支持 Jwxxc Beta。':!ready?(model.fallbackReason??'JWXXC 模型校验尚未完成，暂不可用。'):'持续学习团队打法的试验模型；原模型开发对照弱于均衡。训练不保证每局变强，通过检查的参数在下一副生效。'};
}
