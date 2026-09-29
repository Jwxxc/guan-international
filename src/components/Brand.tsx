import { tx } from '../i18n';
import { assetUrl } from '../game/assetUrl';
import '../styles/brand.css';

export const BRAND_MOTTO = '云在青天水在瓶';

/** Local ImageGen identity: cursive 掼 paired with the GUAN wordmark. */
export function Brand({ compact = false, symbolOnly = false }: { compact?: boolean; symbolOnly?: boolean }) {
  return symbolOnly
    ? <span className="brand-symbol" role="img" aria-label={tx("GUAN 草书掼字")}><img src={assetUrl('assets/brand/guan-calligraphy-mark-v2.png')} alt=""/></span>
    : <span className={`brand-lockup ${compact ? 'brand-compact' : ''}`}>
      <span className="brand-artwork">
        <img className="brand-image" src={assetUrl('assets/brand/guan-calligraphy-lockup-v3.png')} alt={tx("掼 · GÙAN")}/>
        <span className="brand-gilding" aria-hidden="true"/>
      </span>
    </span>;
}
