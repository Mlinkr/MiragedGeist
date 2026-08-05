# -*- coding: utf-8 -*-
"""腾讯云 SCF — COS 专栏文件夹同步（纯标准库，零外部依赖）。
只用 os/json/time/hmac/hashlib/urllib/xml（Python 内置），无需 requirements.txt / InstallDependency。
前端改名/移动图片时 POST 调用本函数。

部署方式：事件函数 + 函数URL(公网)。详见 README.md
"""
import os, json, time, hmac, hashlib, base64, re, urllib.request, urllib.error, urllib.parse
from concurrent.futures import ThreadPoolExecutor
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

def _api(method, path, params=None, data=None, headers=None, parse=False, timeout=10):
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
        with urllib.request.urlopen(req, timeout=timeout) as r:
            txt = r.read()
    except urllib.error.HTTPError as e:
        txt = e.read()
    if parse:
        return ET.fromstring(txt)
    return txt

def _body_bytes(raw, is_b64_event):
    """把 SCF 收到的请求体还原成原始字节。

    腾讯云函数 URL 对 text/plain 二进制 body 会先按 UTF-8 转成 Python str，
    原始字节已不可恢复，因此前端统一改为『base64 字符串』上传，这里再解回字节。
    兼容三种来源：
      1) SCF 自带 base64（isBase64Encoded=True）
      2) 前端显式发的 base64 字符串（合法 base64 即解码）
      3) 纯 ASCII 文本（诊断用，latin1 兜底）
    """
    if isinstance(raw, bytes):
        return raw
    if isinstance(raw, str):
        s = raw.strip()
        if is_b64_event:
            try:
                return base64.b64decode(s)
            except Exception:
                pass
        # 前端上传统一走 base64：看到合法 base64 就解
        if s and len(s) % 4 == 0 and re.fullmatch(r'[A-Za-z0-9+/=]+', s):
            try:
                return base64.b64decode(s)
            except Exception:
                pass
        try:
            return s.encode('latin1')          # 全 ASCII：原样字节
        except Exception:
            return s.encode('utf-8', 'surrogateescape')  # 兜底
    return b''

def do_upload(event, q):
    """中转上传：浏览器把文件以 base64 字符串 POST 过来（body + query 里的 key/ct），
    由本函数在服务端解码并用 COS 密钥签名后直传桶。密钥不离开服务器。"""
    if not SID or not SKEY:
        return {'statusCode': 500, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'COS 凭证未配置'}, ensure_ascii=False), 'isBase64Encoded': False}
    key = (q.get('key') or '').strip()
    if not key:
        return {'statusCode': 400, 'headers': H, 'body': json.dumps({'ok': False, 'err': '缺少 key'}, ensure_ascii=False), 'isBase64Encoded': False}
    ct = q.get('ct') or 'application/octet-stream'
    raw = event.get('body', '')
    data = _body_bytes(raw, event.get('isBase64Encoded'))
    if not data:
        return {'statusCode': 400, 'headers': H, 'body': json.dumps({'ok': False, 'err': '空文件'}, ensure_ascii=False), 'isBase64Encoded': False}
    try:
        _api('PUT', '/' + key, data=data, headers={'Content-Type': ct}, timeout=55)
    except Exception as e:
        msg = str(e)
        m = re.search(r'<Message>([^<]+)</Message>', msg)
        if m: msg = m.group(1)
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': '上传失败：' + msg}, ensure_ascii=False), 'isBase64Encoded': False}
    url = 'https://%s/%s' % (HOST, urllib.parse.quote(key, '/-_.~'))
    return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True, 'key': key, 'url': url}, ensure_ascii=False), 'isBase64Encoded': False}

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
    # 中转上传：二进制 body + query action=upload（在解析 JSON 之前分流）
    q = event.get('queryString') or event.get('queryStringParameters') or {}
    if str(q.get('action', '')).lower() == 'upload':
        try:
            return do_upload(event, q)
        except Exception as e:
            # 任何未捕获异常都返回 200+CORS，避免浏览器因缺 CORS 头而误报「跨域」
            return {'statusCode': 200, 'headers': H,
                    'body': json.dumps({'ok': False, 'err': 'SCF 内部错误：' + str(e)}, ensure_ascii=False),
                    'isBase64Encoded': False}
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
            ks = _ls(o)
            if not ks:
                # 旧文件夹不存在：无需复制（也避免误删）。返回成功，交由前端处理。
                return {'statusCode': 200, 'headers': H,
                        'body': json.dumps({'ok': True, 'copied': 0, 'note': 'old folder empty/not found'}, ensure_ascii=False),
                        'isBase64Encoded': False}
            copied, failed = [], []
            def _cp(k):
                nk = n + k.split('/')[-1]
                try:
                    _api('PUT', '/' + nk, headers={'x-cos-copy-source': f'/{BUCKET}/{urllib.parse.quote(k, safe="/")}'})
                    return k, True
                except Exception:
                    return k, False
            # 并发复制，记录成功项
            with ThreadPoolExecutor(max_workers=10) as ex:
                for k, ok in ex.map(_cp, ks):
                    (copied if ok else failed).append(k)
            # 关键：只删除“已确认复制成功”的旧文件，超时/部分失败也不会丢数据
            def _rm(k):
                try:
                    _api('DELETE', '/' + k)
                    return True
                except Exception:
                    return False
            deleted = 0
            with ThreadPoolExecutor(max_workers=10) as ex:
                for ok in ex.map(_rm, copied):
                    deleted += 1 if ok else 0
            return {'statusCode': 200, 'headers': H, 'isBase64Encoded': False,
                    'body': json.dumps({'ok': True, 'total': len(ks), 'copied': len(copied),
                                        'deleted': deleted, 'failed': len(failed)}, ensure_ascii=False)}
        if a == 'move_object':
            s, d = 'Photos/%s/%s' % (b['from'], b['file']), 'Photos/%s/%s' % (b['to'], b['file'])
            _api('PUT', '/' + d, headers={'x-cos-copy-source': f'/{BUCKET}/{urllib.parse.quote(s, safe="/")}'})
            _api('DELETE', '/' + s)
            return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True}, ensure_ascii=False), 'isBase64Encoded': False}
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'unknown action'}, ensure_ascii=False), 'isBase64Encoded': False}
    except Exception as e:
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': str(e)}, ensure_ascii=False), 'isBase64Encoded': False}
