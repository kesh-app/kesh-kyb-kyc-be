export function maskPhone(v?: string) {
  if (!v) return v;
  const digits = v.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);
  return digits.slice(0, 3) + '*'.repeat(Math.max(0, digits.length - 6)) + digits.slice(-3);
}

export function maskIdNumber(v?: string) {
  if (!v) return v;
  if (v.length <= 6) return '*'.repeat(v.length);
  return v.slice(0, 3) + '*'.repeat(v.length - 6) + v.slice(-3);
}

export function maskEmail(v?: string) {
  if (!v) return v;
  const [u, d] = v.split('@');
  if (!d) return v;
  const keep = Math.min(2, u.length);
  return u.slice(0, keep) + '*'.repeat(Math.max(1, u.length - keep)) + '@' + d;
}
