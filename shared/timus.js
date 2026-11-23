export const timusOrigin = 'https://acm.timus.ru';
export const timusHosts = ['acm.timus.ru', 'timus.online'];

export const timusCategories = {
  structure:'Data Structures', dynprog:'Dynamic Programming', game:'Games', geometry:'Geometry',
  graphs:'Graph Theory', math:'Mathematics', numbers:'Number Theory', palindromes:'Palindromes',
  string:'String Algorithms', beginners:'For Beginners', hardest:'Hardest', tricky:'Tricky', unusual:'Unusual',
};

export function normalizeTimusAuthor(value) {
  const raw = value.trim();
  const id = text => text?.match(/^0*([1-9]\d{0,9})$/)?.[1] ?? null;
  if (/^\d+$/.test(raw)) return id(raw);
  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port
      || !timusHosts.includes(url.hostname.toLowerCase().replace(/^www\./, ''))
      || url.pathname.toLowerCase() !== '/author.aspx' || url.searchParams.getAll('id').length !== 1) return null;
  return id(url.searchParams.get('id'));
}
