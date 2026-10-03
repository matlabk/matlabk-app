/**
 * Cloudflare Worker (reference implementation — NOT the deployed worker, source of which was unavailable).
 * - يتحقق من Firebase ID Token (JWKS) → لا توقيع لمجهول.
 * - يوقّع فقط: folder ثابت لكل مستخدم + transformation/format محددة + timestamp.
 * - Rate limit: Cloudflare Rate Limiting binding (RL) 10 req / 60s لكل uid.
 * Secrets (wrangler secret put): CLOUDINARY_API_SECRET ; vars: CLOUDINARY_API_KEY, CLOUDINARY_CLOUD, FIREBASE_PROJECT_ID, ALLOWED_ORIGIN
 * Cloudinary upload preset (Signed) يجب أن يفرض: allowed_formats=jpg,png,webp ، max_file_size=5MB ، resource_type=image.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));

async function sha1Hex(s) {
  const b = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
export default {
  async fetch(req, env) {
    const cors = { 'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Authorization', Vary: 'Origin' };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (req.method !== 'GET') return new Response('method', { status: 405, headers: cors });
    const token = (req.headers.get('Authorization') || '').replace(/^Bearer /, '');
    let uid;
    try {
      const { payload } = await jwtVerify(token, JWKS, { issuer: `https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`, audience: env.FIREBASE_PROJECT_ID });
      uid = payload.sub;
    } catch { return new Response('unauthorized', { status: 401, headers: cors }); }
    if (env.RL && !(await env.RL.limit({ key: uid })).success) return new Response('rate', { status: 429, headers: cors });
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = `matlabk/${uid}`; // أصول قديمة تحت mova/ تبقى كما هي (Legacy) - الرفع الجديد تحت matlabk/
    const toSign = `allowed_formats=jpg,png,webp&folder=${folder}&timestamp=${timestamp}`;
    const signature = await sha1Hex(toSign + env.CLOUDINARY_API_SECRET);
    return Response.json({ timestamp, signature, apiKey: env.CLOUDINARY_API_KEY, cloudName: env.CLOUDINARY_CLOUD, folder, allowed_formats: 'jpg,png,webp' }, { headers: cors });
  },
};
