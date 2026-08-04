# -*- coding: utf-8 -*-
"""腾讯云 SCF — COS 专栏文件夹同步（纯标准库，零外部依赖）。
只用 os/json/time/hmac/hashlib/urllib/xml（Python 内置），无需 requirements.txt / InstallDependency。
前端改名/移动图片时 POST 调用本函数。

部署方式：事件函数 + 函数URL(公网)。详见 README.md
"""
import os, json, time, hmac, hashlib, base64, urllib.request, urllib.error, urllib.parse
import xml.etree.ElementTree as ET

SID = os.environ.get('COS_SECRET_ID', '')
SKEY = os.environ.get('COS_SECRET_KEY', '')
BUCKET = os.environ.get('COS_BUCKET', 'miragedgeist-1463128155')
REGION = os.environ.get('COS_REGION', 'ap-guangzhou')
HOST = f'{BUCKET}.cos.{REGION}.myqcloud.com'
H = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}

# 参与签名的头部白名单（与腾讯云 COS SDK 的 filter_headers 保持一致）
_VALID_HEADERS = {
    "cache-control", "content-disposition", "content-encoding", "content-type",
    "content-md5", "content-length", "expect", "expires", "host", "if-match",
    "if-modified-since", "if-none-match", "if-unmodified-since", "origin", "range",
    "transfer-encoding", "pic-operations",
}

def _enc(s):
    """COS V1 签名要求：key/value 用 quote 且安全字符集为 '-_.~'（/ 会被编码，'-_.~' 保留）。"""
    return urllib.parse.quote(str(s), safe='-_.~')

def _lname(tag):
    return tag.split('}')[-1]

def _sign(method, path, params=None, headers=None):
    """COS V1 签名（HMAC-SHA1）。复刻官方 qcloud_cos SDK 的算法，零依赖。"""
    now = int(time.time())
    kt = f'{now-60};{now+600}'
    # 仅保留需要签名的头部；key 统一小写
    hk = {}
    for k, v in (headers or {}).items():
        lk = k.lower()
        if lk in _VALID_HEADERS or lk.startswith('x-cos-') or lk.startswith('x-ci-'):
            hk[lk] = v
    if 'host' not in hk:
        hk['host'] = HOST
    hs = '&'.join(f'{_enc(k)}={_enc(v)}' for k, v in sorted(hk.items()))
    ps = '&'.join(f'{_enc(k)}={_enc(v)}' for k, v in sorted((params or {}).items()))
    # 关键点：method 必须小写；path 用原始（未编码）路径；各段以 \n 分隔，结尾一个 \n
    http_str = f'{method.lower()}\n{path}\n{ps}\n{hs}\n'
    sign_key = hmac.new(SKEY.encode(), kt.encode(), hashlib.sha1).hexdigest()
    s1 = hashlib.sha1(http_str.encode()).hexdigest()
    str_to_sign = f'sha1\n{kt}\n{s1}\n'
    signature = hmac.new(sign_key.encode(), str_to_sign.encode(), hashlib.sha1).hexdigest()
    header_list = ';'.join(sorted(hk.keys()))
    param_list = ';'.join(sorted((params or {}).keys()))
    return (f'q-sign-algorithm=sha1&q-ak={SID}&q-sign-time={kt}&q-key-time={kt}'
            f'&q-header-list={header_list}&q-url-param-list={param_list}&q-signature={signature}')

def _api(method, path, params=None, data=None, headers=None, parse=False):
    hdrs = {'Host': HOST}
    if headers:
        hdrs.update(headers)
    # URL 查询串：与签名使用的编码保持一致（'-_.~' 安全集）
    query = '&'.join(f'{_enc(k)}={_enc(v)}' for k, v in sorted((params or {}).items())) if params else ''
    # URL 路径：用 '-_.~' 安全集编码（/ 保留，中文转义），签名里则仍用原始 path
    url = 'https://' + HOST + urllib.parse.quote(path, '/-_.~')
    if query:
        url += '?' + query
    body = data if isinstance(data, bytes) else (json.dumps(data).encode() if data else None)
    if body:
        hdrs['Content-Length'] = str(len(body))
    hdrs['Authorization'] = _sign(method, path, params, hdrs)
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            txt = r.read()
    except urllib.error.HTTPError as e:
        txt = e.read()
    if parse:
        return ET.fromstring(txt)
    return txt

def _ls(prefix):
    ks, m = [], ''
    while True:
        root = _api('GET', '/', {'prefix': prefix, 'max-keys': '1000', 'marker': m}, parse=True)
        for c in root.iter():
            if _lname(c.tag) == 'Contents':
                for sub in c:
                    if _lname(sub.tag) == 'Key' and sub.text:
                        ks.append(sub.text)
        is_trunc = next_m = None
        for sub in root:
            n = _lname(sub.tag)
            if n == 'IsTruncated':
                is_trunc = sub.text
            elif n == 'NextMarker':
                next_m = sub.text
        if is_trunc == 'true' and next_m:
            m = next_m
        else:
            break
    return ks

def main_handler(event, context):
    if str(event.get('httpMethod', '')).upper() == 'OPTIONS':
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True}, ensure_ascii=False), 'isBase64Encoded': False}
    if not SID or not SKEY:
        return {'statusCode': 500, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'COS 凭证未配置'}, ensure_ascii=False), 'isBase64Encoded': False}
    try:
        b = event.get('body', '{}')
        # 腾讯云函数 URL / API 网关 在部分情况下会把请求体做 base64 编码并置 isBase64Encoded=true
        if isinstance(b, str) and event.get('isBase64Encoded'):
            try:
                b = base64.b64decode(b).decode('utf-8')
            except Exception:
                pass
        if isinstance(b, str):
            try:
                b = json.loads(b)
            except Exception:
                b = {}
        if not isinstance(b, dict):
            b = {}
        a = b.get('action')
        if a == 'rename_folder':
            o, n = 'Photos/%s/' % b['old'], 'Photos/%s/' % b['new']
            # 先复制，再删除旧文件（COS 无 rename，靠 copy+delete 实现）
            for k in _ls(o):
                nk = n + k.split('/')[-1]
                _api('PUT', '/' + nk, headers={'x-cos-copy-source': f'/{BUCKET}/{urllib.parse.quote(k, safe="/")}'})
            for k in _ls(o):
                _api('DELETE', '/' + k)
            return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True}, ensure_ascii=False), 'isBase64Encoded': False}
        if a == 'move_object':
            s, d = 'Photos/%s/%s' % (b['from'], b['file']), 'Photos/%s/%s' % (b['to'], b['file'])
            _api('PUT', '/' + d, headers={'x-cos-copy-source': f'/{BUCKET}/{urllib.parse.quote(s, safe="/")}'})
            _api('DELETE', '/' + s)
            return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True}, ensure_ascii=False), 'isBase64Encoded': False}
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'unknown action'}, ensure_ascii=False), 'isBase64Encoded': False}
    except Exception as e:
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': str(e)}, ensure_ascii=False), 'isBase64Encoded': False}
