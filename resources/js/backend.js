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

export async function uploadPhoto(file, userId, bucket = 'scpos-products') {
    await validatePhoto(file);
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    const path = userId + '/' + crypto.randomUUID() + '.' + extensions[file.type];
    const { error } = await backend().storage.from(bucket).upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
}

export async function validatePhoto(file) {
    if (!file || !['image/jpeg','image/png','image/webp'].includes(file.type) || !file.size || file.size > 2 * 1024 * 1024) throw new Error('Gambar harus JPG, PNG, atau WebP, maksimal 2 MB.');
    const bytes = new Uint8Array(await file.slice(0,12).arrayBuffer());
    const signature = file.type === 'image/png' ? [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)
        : file.type === 'image/jpeg' ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
        : String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP';
    if (!signature) throw new Error('Isi gambar tidak sesuai format JPG, PNG, atau WebP.');
}

export function logoUrl(path) {
    return path ? backend().storage.from('scpos-branding').getPublicUrl(path).data.publicUrl : '';
}

export async function avatarUrl(path) {
    if (!path) return '';
    const { data, error } = await backend().storage.from('scpos-avatars').createSignedUrl(path, 3600);
    if (error) throw error;
    return data.signedUrl;
}

export async function removeUnusedPhoto(bucket, path) {
    if (path) await backend().storage.from(bucket).remove([path]);
}

export async function photoUrls(products) {
    const paths = [...new Set(products.map(product => product.photo_path).filter(Boolean))];
    if (!paths.length) return {};
    const { data, error } = await backend().storage.from('scpos-products').createSignedUrls(paths, 3600);
    if (error) throw error;
    return Object.fromEntries(data.filter(row => row.signedUrl).map(row => [row.path, row.signedUrl]));
}
