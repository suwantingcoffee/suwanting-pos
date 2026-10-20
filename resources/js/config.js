export function validateConfig(url, key) {
    if (!url || !key) throw new Error('Isi Project URL dan publishable key Supabase.');
    const parsed = new URL(url.trim());
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if (parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/' ||
        (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:'))) {
        throw new Error('Gunakan Project URL Supabase HTTPS.');
    }
    key = key.trim();
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(key);
    if (key.startsWith('eyJ')) {
        try {
            const payload = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            publicKey = JSON.parse(atob(payload)).role === 'anon';
        } catch { publicKey = false; }
    }
    if (!publicKey) throw new Error('Gunakan publishable/anon key. Secret/service_role key dilarang di browser.');
    return { url: parsed.origin, key };
}

export const defaultConfig = {
    url: import.meta.env?.VITE_SUPABASE_URL || 'https://scfvibqjzlflbbpnrdjv.supabase.co',
    key: import.meta.env?.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_cNQojAxYzhkB1YDSK6K2qQ_71c0lwhu',
};

export function getConfig() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem('suwanting-supabase') || 'null'); } catch { /* Use build configuration. */ }
    return validateConfig(saved?.url || defaultConfig.url, saved?.key || defaultConfig.key);
}
