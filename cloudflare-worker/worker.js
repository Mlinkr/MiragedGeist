// 腾讯云 COS 预签名上传 Worker（手机直传原画质大图，SecretKey 只存 Worker 环境变量）
// 流程：前端 POST {folder,filename} → Worker 返回一次性预签名 PUT URL → 前端直传 COS（不绕 Worker，不限大小）
// 环境变量：COS_SECRET_ID  COS_SECRET_KEY  COS_BUCKET  COS_REGION

function hex(buf){ return [...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function hmacSha1(keyBytes, msgStr){
  const key = await crypto.subtle.importKey('raw', keyBytes, {name:'HMAC', hash:'SHA-1'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(msgStr));
  return new Uint8Array(sig);
}
async function sha1Hex(str){
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(str));
  return hex(d);
}

export default {
  async fetch(request, env){
    if(request.method !== 'POST')
      return new Response('POST {folder,filename} 获取 COS 预签名上传 URL', {status:405});
    let body={}; try{ body = await request.json(); }catch{}

    const folder = (body.folder||'Photos').replace(/^\/+|\/+$/g,'').replace(/[^\w\-]/g,'');
    const filename = (body.filename||'').replace(/[^\w.\-]/g,'_');
    if(!filename) return new Response('缺少 filename', {status:400});

    const key = folder ? `${folder}/${filename}` : filename;
    const now = Math.floor(Date.now()/1000);
    const signTime = `${now-60};${now+600}`;                       // 有效期 10 分钟
    const host = `${env.COS_BUCKET}.cos.${env.COS_REGION}.myqcloud.com`;
    const path = '/' + key;

    // —— 与腾讯云 SDK 完全一致的签名算法 ——
    const fmt = `put\n${path}\n\nhost=${host}\n`;                  // 注意：host 处是对象路径，真实 host 在 headers
    const sha1 = await sha1Hex(fmt);
    const strToSign = `sha1\n${signTime}\n${sha1}\n`;
    const signKeyHex = hex(await hmacSha1(new TextEncoder().encode(env.COS_SECRET_KEY), signTime));
    const sig = hex(await hmacSha1(new TextEncoder().encode(signKeyHex), strToSign));

    const presigned = `https://${host}/${key}?q-sign-algorithm=sha1&q-ak=${env.COS_SECRET_ID}`
      + `&q-sign-time=${signTime}&q-key-time=${signTime}&q-header-list=host&q-url-param-list=&q-signature=${sig}`;
    const pub = `https://${host}/${key}`;

    return new Response(JSON.stringify({ url: presigned, public: pub, key, thumb: `${pub}?imageMogr2/thumbnail/1600x` }),
      { headers: { 'content-type':'application/json', 'access-control-allow-origin':'*' } });
  }
};
