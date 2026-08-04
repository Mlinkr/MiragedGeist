# 腾讯云函数 SCF（事件函数 + HTTP 触发）版本：COS 预签名上传签名服务
# 作用与 cloudflare-worker/worker.js 完全相同：前端 POST {folder,filename} → 返回一次性预签名 PUT URL → 前端直传 COS。
# 好处：和 COS 同一腾讯云账号，不用 Cloudflare。SecretKey 只存函数环境变量，不下发前端。
#
# 环境变量（函数配置 → 环境变量）：COS_SECRET_ID  COS_SECRET_KEY  COS_BUCKET  COS_REGION
# 执行方法：index.main_handler

import os, json, hashlib, hmac, time, re

def _hmac(key, msg): return hmac.new(key, msg.encode(), hashlib.sha1).digest()
def _hex(b): return ''.join(f'{x:02x}' for x in b)

def build_presigned(folder, filename, now=None):
    sid = os.environ['COS_SECRET_ID']
    skey = os.environ['COS_SECRET_KEY']
    bucket = os.environ['COS_BUCKET']
    region = os.environ['COS_REGION']
    now = now or int(time.time())
    sign_time = f"{now-60};{now+600}"                       # 有效期 10 分钟
    host = f"{bucket}.cos.{region}.myqcloud.com"
    path = f"/{folder}/{filename}"
    # 与腾讯云 SDK 完全一致的签名算法
    fmt = f"put\n{path}\n\nhost={host}\n"                    # host 处是对象路径，真实 host 在 headers
    sha1 = hashlib.sha1(fmt.encode()).hexdigest()
    str_to_sign = f"sha1\n{sign_time}\n{sha1}\n"
    sign_key = _hex(_hmac(skey.encode(), sign_time))
    sig = _hex(_hmac(sign_key.encode(), str_to_sign))
    presigned = (f"https://{host}/{folder}/{filename}?q-sign-algorithm=sha1&q-ak={sid}"
                 f"&q-sign-time={sign_time}&q-key-time={sign_time}&q-header-list=host&q-url-param-list=&q-signature={sig}")
    pub = f"https://{host}/{folder}/{filename}"
    return {'url': presigned, 'public': pub, 'key': f"{folder}/{filename}",
            'thumb': f"{pub}?imageMogr2/thumbnail/1600x"}

def main_handler(event, context):
    if event.get('httpMethod') == 'OPTIONS':
        return {'statusCode': 204,
                'headers': {'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'POST,OPTIONS',
                            'Access-Control-Allow-Headers': 'content-type'}, 'body': ''}
    try:
        body = json.loads(event.get('body') or '{}')
    except Exception:
        body = {}
    folder = re.sub(r'[^A-Za-z]', '', body.get('folder') or 'Photos')
    filename = re.sub(r'[^\w.\-]', '_', str(body.get('filename', '')))
    if not filename:
        return {'statusCode': 400, 'headers': {'Access-Control-Allow-Origin': '*'}, 'body': 'missing filename'}
    try:
        res = build_presigned(folder, filename)
    except KeyError as e:
        return {'statusCode': 500, 'headers': {'Access-Control-Allow-Origin': '*'},
                'body': f'缺少环境变量 {e}'}
    return {'statusCode': 200,
            'headers': {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*'},
            'body': json.dumps(res, ensure_ascii=False)}
