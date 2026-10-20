import { createClient } from '@supabase/supabase-js';
import { getConfig } from './config.js';

let client;
export function backend() {
    if (client) return client;
    const { url, key } = getConfig();
    client = createClient(url, key, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'suwanting-pos-auth' },
    });
    return client;
}

export async function rpc(name, args = {}, timeout = 20000) {
    const { data, error } = await backend().rpc('scpos_' + name, args).abortSignal(AbortSignal.timeout(timeout));
    if (error) {
        const failure = new Error(error.message || 'Koneksi ke Supabase gagal. Coba lagi.');
        failure.code = error.code;
        throw failure;
    }
    return data;
}

export async function uploadPhoto(file, userId) {
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    if (!extensions[file.type] || file.size > 2 * 1024 * 1024) throw new Error('Foto harus JPG, PNG, atau WebP, maksimal 2 MB.');
    const path = userId + '/' + crypto.randomUUID() + '.' + extensions[file.type];
    const { error } = await backend().storage.from('scpos-products').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
}

export async function photoUrls(products) {
    const paths = [...new Set(products.map(product => product.photo_path).filter(Boolean))];
    if (!paths.length) return {};
    const { data, error } = await backend().storage.from('scpos-products').createSignedUrls(paths, 3600);
    if (error) throw error;
    return Object.fromEntries(data.filter(row => row.signedUrl).map(row => [row.path, row.signedUrl]));
}
