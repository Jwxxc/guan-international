/** Distribution capabilities are fixed at build time, never inferred from a URL. */
export const isPortableDistribution = typeof import.meta.env !== 'undefined' && import.meta.env.GUAN_DISTRIBUTION === 'portable';

export const isFullMacDistribution = typeof import.meta.env !== 'undefined' && import.meta.env.GUAN_DISTRIBUTION === 'full-mac';
