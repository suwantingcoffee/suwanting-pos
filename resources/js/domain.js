export const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
export const dateTime = value => value ? new Intl.DateTimeFormat('id-ID', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jakarta' }).format(new Date(value)) : '—';
export const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export const quantity = value => new Intl.NumberFormat('id-ID', { maximumFractionDigits: 3 }).format(Number(value || 0));

export function decimalUnits(value, precision = 2) {
    const input = String(value ?? '0').trim();
    if (!new RegExp(`^\\d{1,9}(?:\\.\\d{1,${precision}})?$`).test(input)) throw new Error('Nominal atau kuantitas tidak valid.');
    const [whole, fraction = ''] = input.split('.');
    const units = Number(whole) * 10 ** precision + Number(fraction.padEnd(precision, '0'));
    if (!Number.isSafeInteger(units)) throw new Error('Nominal terlalu besar.');
    return units;
}

export function cartTotals(lines, discount, settings) {
    const subtotal = lines.reduce((sum, line) => sum + decimalUnits(line.unit_price) * line.quantity, 0);
    const deducted = Math.min(subtotal, decimalUnits(discount || '0'));
    const rate = settings.tax_enabled ? decimalUnits(settings.tax_rate) : 0;
    const tax = Math.floor(((subtotal - deducted) * rate + 5000) / 10000);
    return { subtotal: subtotal / 100, discount: deducted / 100, tax: tax / 100, total: (subtotal - deducted + tax) / 100 };
}

export function csv(rows, fields) {
    const cell = value => {
        let text = String(value ?? '');
        if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
        return '"' + text.replaceAll('"', '""') + '"';
    };
    return '\uFEFF' + [fields.map(field => cell(field.label)).join(','), ...rows.map(row => fields.map(field => cell(row[field.key])).join(','))].join('\r\n');
}

export function routeFromHash(hash) {
    const [path, query = ''] = hash.replace(/^#\/?/, '').split('?');
    const parts = path.split('/').filter(Boolean);
    return { page: parts[0] || 'dashboard', id: parts[1] || null, query: new URLSearchParams(query) };
}

export const definitiveFailure = error => ['22023', '23514', '23505', '23503', '42501', 'P0002', '22P02'].includes(error?.code);
