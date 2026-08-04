# -*- coding: utf-8 -*-
"""腾讯云 SCF — COS 专栏文件夹同步（纯标准库，零外部依赖）。
只用 os/json/time/hmac/hashlib/urllib（Python 内置），无需 requirements.txt / InstallDependency。
前端改名/移动图片时 POST 调用本函数。"""
import os, json, time, hmac, hashlib, urllib.request, urllib.error, urllib.parse

SID = os.environ.get('COS_SECRET_ID', '')
SKEY = os.environ.get('COS_SECRET_KEY', '')
BUCKET = os.environ.get('COS_BUCKET', 'miragedgeist-1463128155')
REGION = os.environ.get('COS_REGION', 'ap-guangzhou')
HOST = f'{BUCKET}.cos.{REGION}.myqcloud.com'
H = {'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
     'Access-Control-Allow-Methods': 'POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type'}

def _sign(method, path, params=None, headers=None):
    now = int(time.time())
    kt = f'{now};{now+3600}'
    hl = sorted((headers or {}).keys()) if headers else []
    pl = sorted((params or {}).keys()) if params else []
    hs = '\n'.join(f'{k.lower()}:{(headers or {})[k]}' for k in hl) + ('\n' if hl else '')
    ps = '&'.join(f'{k}={(params or {})[k]}' for k in pl)
    http_str = f'{method}\n{path}\n{ps}\n{hs}\n'
    sig = hashlib.sha1(hmac.new(SKEY.encode(), kt.encode(), hashlib.sha1).digest()).hexdigest()
    sig = hashlib.sha1(hmac.new(sig.encode(), http_str.encode(), hashlib.sha1).digest()).hexdigest()
    return f'q-sign-algorithm=sha1&q-ak={SID}&q-sign-time={kt}&q-key-time={kt}&q-header-list={";".join(hl)}&q-url-param-list={";".join(pl)}&q-signature={sig}'

def _api(method, path, params=None, data=None):
    hdrs = {'Host': HOST, 'Authorization': _sign(method, path, params)}
    url = f'https://{HOST}{path}'
    if params: url += '?' + urllib.parse.urlencode(params)
    body = json.dumps(data).encode() if data else None
    if body: hdrs['Content-Length'] = str(len(body))
    req = urllib.request.Request(url, data=body, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        b = e.read()
        return json.loads(b) if b else {'code': e.code, 'message': str(e)}

def _ls(prefix):
    ks, m = [], ''
    while True:
        j = _api('GET', '/', {'prefix': prefix, 'max-keys': '1000', 'marker': m})
        ks += [c['Key'] for c in j.get('Contents', [])]
        if j.get('IsTruncated') == 'true':
            m = j['NextMarker']
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
        if isinstance(b, str): b = json.loads(b)
        a = b.get('action')
        if a == 'rename_folder':
            o, n = 'Photos/%s/' % b['old'], 'Photos/%s/' % b['new']
            for k in _ls(o):
                nk = n + k.split('/')[-1]
                _api('PUT', '/' + nk, headers={'x-cos-copy-source': f'/{BUCKET}/{k}'})
            for k in _ls(o):
                _api('DELETE', '/' + k)
            return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True}, ensure_ascii=False), 'isBase64Encoded': False}
        if a == 'move_object':
            s, d = 'Photos/%s/%s' % (b['from'], b['file']), 'Photos/%s/%s' % (b['to'], b['file'])
            _api('PUT', '/' + d, headers={'x-cos-copy-source': f'/{BUCKET}/{s}'})
            _api('DELETE', '/' + s)
            return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True}, ensure_ascii=False), 'isBase64Encoded': False}
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'unknown action'}, ensure_ascii=False), 'isBase64Encoded': False}
    except Exception as e:
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': str(e)}, ensure_ascii=False), 'isBase64Encoded': False}
