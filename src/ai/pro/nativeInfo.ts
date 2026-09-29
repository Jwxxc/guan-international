/** Metadata only. Restricted native weights are never imported into the browser. */
export const DANLM_MODEL_HASH='5341d7316bac1ead4098c796ea03f7e38fb47f001cc647a52be3ed0d15cd7244';
export const DANLM_ENCODER_VERSION='guan-danlm-observation-v1';
export const DANLM_CLASSIC_ENCODER_VERSION='guan-danlm-observation-v2';
export const DANLM_SUPPORTED_ENCODERS=[DANLM_ENCODER_VERSION,DANLM_CLASSIC_ENCODER_VERSION] as const;
export const DANLM_OBJECTIVE='round-return';
export const DANLM_BACKEND='pytorch-cpu-arm64';
export const nativeDanlmEnabled=()=>typeof import.meta.env!=='undefined'&&import.meta.env.GUAN_PRO_NATIVE_ENABLED===true;
export const isNativeDanlmStrategy=(id:string|undefined)=>id==='pro-danlm-v1'||id==='pro-danlm-classic-v1';
