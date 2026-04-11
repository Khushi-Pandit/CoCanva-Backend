export function getSafeId(val: any): string {
  if (!val) return '';
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && val._id) return val._id.toString();
  if (typeof val.toString === 'function') {
    const str = val.toString();
    if (str !== '[object Object]') return str;
  }
  return String(val);
}
