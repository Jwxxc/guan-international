/** Public assets must also work under a GitHub Pages repository subpath. */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`;
