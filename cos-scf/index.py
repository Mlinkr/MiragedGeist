# -*- coding: utf-8 -*-
"""腾讯云 SCF — COS 专栏文件夹同步（纯标准库，零外部依赖）· v5.1

只用 os/json/time/hmac/hashlib/urllib/xml（Python 内置），无需 requirements.txt / InstallDependency。
前端上传 / 改名 / 移动 / 删除图片时 POST 调用本函数。

支持的 action：
  query  : action=upload   —— base64 中转上传（小文件，≤ ~6MB）
  query  : action=presign  —— 返回预签名 PUT URL（大文件直传桶，无体量限制）
  body   : rename_folder   —— 整个文件夹改名（COPY + DELETE）
  body   : move_object     —— 单个对象移动
  body   : create_folder   —— ★v5.1 新建文件夹（PUT 0 字节占位对象 prefix/）
  body   : delete_object   —— ★v5.1 删除单个对象（原图 / 缩略图）
  body   : delete_folder   —— ★v5.1 删除整个文件夹及其下全部对象

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
     'Access-Control-Allow-Methods': 'GET,POST,OPTIONS,PUT', 'Access-Control-Allow-Headers': 'Content-Type'}

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
    """中转上传（兼容旧前端）：浏览器把文件以 base64 字符串 POST 过来，
    由本函数解码后用 COS 密钥签名直传桶。受 SCF 函数 URL ~6MB 体量限制，
    大文件请改用 do_presign（预签名直传）。"""
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

def do_presign(event, q):
    """返回 COS 预签名 PUT URL（v4.0 新接口）。

    前端流程：
      1) 向本接口 POST {key, contentType} → 拿到 presignedUrl
      2) 浏览器用 XHR PUT 原始文件到该 URL（直传桶，不经过 SCF）

    优势：
      - 无体量限制（SCF 只处理几十字节的元数据请求）
      - 密钥不离开服务器（签名由 SCF 服务端完成）
      - 上传进度真实可追踪（XHR.upload.onprogress）
    """
    if not SID or not SKEY:
        return {'statusCode': 500, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'COS 凭证未配置'}, ensure_ascii=False), 'isBase64Encoded': False}
    key = (q.get('key') or '').strip()
    if not key:
        return {'statusCode': 400, 'headers': H, 'body': json.dumps({'ok': False, 'err': '缺少 key'}, ensure_ascii=False), 'isBase64Encoded': False}
    ct = q.get('ct') or 'application/octet-stream'
    # 预签名有效期 15 分钟
    now = int(time.time())
    kt = f'{now-60};{now+900}'
    sign_headers = {'content-type': ct, 'host': HOST}
    auth = _sign('put', '/' + key, headers=sign_headers)
    put_url = ('https://' + HOST + urllib.parse.quote(key, '/-_.~')
               + '?q-sign-algorithm=sha1&q-ak=' + SID
               + '&q-sign-time=' + kt + '&q-key-time=' + kt
               + '&q-header-list=content-type;host'
               + '&q-url-param-list='
               + '&q-signature=' + auth.split('&q-signature=')[1] if '&q-signature=' in auth else '')
    # 更简洁的拼法：直接用 _sign 返回值作为查询参数
    put_url = 'https://' + HOST + '/' + urllib.parse.quote(key, '/-_.~') + '?' + _sign('put', '/' + key, headers={'content-type': ct})
    return {'statusCode': 200, 'headers': H,
            'body': json.dumps({'ok': True, 'key': key,
                                'putUrl': put_url,
                                'finalUrl': 'https://%s/%s' % (HOST, urllib.parse.quote(key, '/-_.~'))},
                               ensure_ascii=False),
            'isBase64Encoded': False}

# ============================================================
# 访客统计（Stats）
# ------------------------------------------------------------
# 设计要点：把一次访问的全部维度编码进「对象键」本身，对象内容为 0 字节。
# 聚合时只需 ListObjects（一次请求返回 1000 个键），无需逐个 GET，
# 因此几千条访问记录也能秒级返回，且几乎不产生流量费。
#
# 键格式： Stats/v1/{YYYY-MM-DD}/{HHMMSS}~{vid}~{dev}~{os}~{br}~{src}~{path_b64}
#   vid  访客指纹 = sha256(IP + UA + 日期)[:8]，同一人同一天同一指纹 → 用于 UV 去重
#        ★ 不存储原始 IP，逐日加盐，无法反查真实身份
#   dev  m=手机 t=平板 d=桌面
#   os   ios/and/win/mac/lnx/oth
#   br   chr/saf/fir/edg/wx/qq/oth
#   src  来源短码（direct / 搜索引擎名 / 站外域名）
#   path 页面路径，base64url 编码（避免 / 与中文破坏键结构）
# ============================================================
STATS_PREFIX = 'Stats/v1/'
_BOT_RE = re.compile(r'bot|crawl|spider|slurp|curl|wget|python-requests|headless|lighthouse|pingdom|uptime', re.I)

def _b64u(s):
    """base64url 编码（去掉 = 填充），用于把任意路径塞进对象键。"""
    return base64.urlsafe_b64encode(s.encode('utf-8')).decode('ascii').rstrip('=')

def _b64u_dec(s):
    try:
        return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4)).decode('utf-8', 'replace')
    except Exception:
        return ''

def _bj_now():
    """北京时间（UTC+8）。云函数默认 UTC，直接偏移 8 小时。"""
    return time.gmtime(time.time() + 8 * 3600)

def _parse_ua(ua):
    """从 User-Agent 解析设备 / 系统 / 浏览器短码。顺序有讲究：先判专有客户端再判通用内核。"""
    u = (ua or '').lower()
    # 系统
    if 'iphone' in u or 'ipod' in u:
        os_, dev = 'ios', 'm'
    elif 'ipad' in u:
        os_, dev = 'ios', 't'
    elif 'android' in u:
        os_ = 'and'
        dev = 't' if 'mobile' not in u else 'm'
    elif 'windows' in u:
        os_, dev = 'win', 'd'
    elif 'mac os' in u or 'macintosh' in u:
        os_, dev = 'mac', 'd'
    elif 'linux' in u or 'x11' in u:
        os_, dev = 'lnx', 'd'
    else:
        os_, dev = 'oth', 'd'
    # 浏览器：微信/QQ 内置浏览器要在 Chrome/Safari 之前判断（它们的 UA 里也带 Chrome）
    if 'micromessenger' in u:
        br = 'wx'
    elif ' qq' in u or 'qqbrowser' in u:
        br = 'qq'
    elif 'edg' in u:
        br = 'edg'
    elif 'firefox' in u or 'fxios' in u:
        br = 'fir'
    elif 'chrome' in u or 'crios' in u:
        br = 'chr'
    elif 'safari' in u:
        br = 'saf'
    else:
        br = 'oth'
    return dev, os_, br

def _parse_src(ref, self_host):
    """来源归类：站内跳转不计，搜索引擎归名，其余记域名。"""
    if not ref:
        return 'direct'
    try:
        h = urllib.parse.urlparse(ref).netloc.lower()
    except Exception:
        return 'direct'
    if not h or (self_host and h == self_host.lower()):
        return 'direct'
    for k, name in (('google', 'Google'), ('baidu', '百度'), ('bing', 'Bing'),
                    ('sogou', '搜狗'), ('so.com', '360'), ('duckduckgo', 'DuckDuckGo'),
                    ('yandex', 'Yandex'), ('t.co', 'X/Twitter'), ('weibo', '微博'),
                    ('zhihu', '知乎'), ('xiaohongshu', '小红书'), ('douban', '豆瓣'),
                    ('github', 'GitHub')):
        if k in h:
            return name
    return h[:40]

def do_visit(event, q):
    """记录一次访问：写 0 字节对象，键里带全部维度。永远返回 200，绝不影响前端。"""
    try:
        if not SID or not SKEY:
            return {'statusCode': 200, 'headers': H, 'body': '{"ok":false}', 'isBase64Encoded': False}
        hd = {str(k).lower(): v for k, v in (event.get('headers') or {}).items()}
        ua = str(hd.get('user-agent', ''))[:400]
        # 机器人不计入
        if _BOT_RE.search(ua):
            return {'statusCode': 200, 'headers': H, 'body': '{"ok":true,"skip":"bot"}', 'isBase64Encoded': False}
        ip = str(hd.get('x-forwarded-for', '') or hd.get('x-real-ip', '')).split(',')[0].strip()
        ref = str(q.get('r') or hd.get('referer', ''))[:300]
        path = str(q.get('p') or '/')[:120]
        host = str(hd.get('host', ''))
        # 前端传来的真实来源优先（hash 路由下 referer 常为空）
        t = _bj_now()
        date = time.strftime('%Y-%m-%d', t)
        # 访客指纹：逐日加盐的哈希，无法反查 IP
        vid = hashlib.sha256(('%s|%s|%s' % (ip, ua, date)).encode('utf-8')).hexdigest()[:8]
        dev, os_, br = _parse_ua(ua)
        src = _parse_src(ref, q.get('h') or host)
        key = '%s%s/%s~%s~%s~%s~%s~%s~%s' % (
            STATS_PREFIX, date, time.strftime('%H%M%S', t), vid, dev, os_, br,
            _b64u(src), _b64u(path))
        _api('PUT', '/' + key, data=b'', headers={'Content-Length': '0'})
        return {'statusCode': 200, 'headers': H, 'body': '{"ok":true}', 'isBase64Encoded': False}
    except Exception:
        # 统计失败绝不能影响访客浏览，静默成功
        return {'statusCode': 200, 'headers': H, 'body': '{"ok":false}', 'isBase64Encoded': False}

_DEV_NAME = {'m': '手机', 't': '平板', 'd': '电脑'}
_OS_NAME = {'ios': 'iOS', 'and': 'Android', 'win': 'Windows', 'mac': 'macOS', 'lnx': 'Linux', 'oth': '其他'}
_BR_NAME = {'chr': 'Chrome', 'saf': 'Safari', 'fir': 'Firefox', 'edg': 'Edge',
            'wx': '微信内置', 'qq': 'QQ浏览器', 'oth': '其他'}

def do_stats(event, q):
    """聚合查询：list 最近 N 天的键并解析，返回统计 JSON。"""
    if not SID or not SKEY:
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'COS 凭证未配置'}), 'isBase64Encoded': False}
    try:
        days = max(1, min(90, int(q.get('days') or 30)))
    except Exception:
        days = 30
    now = time.time() + 8 * 3600
    dates = [time.strftime('%Y-%m-%d', time.gmtime(now - i * 86400)) for i in range(days)]
    want = set(dates)
    today = dates[0]

    daily = {d: {'pv': 0, 'uv': set()} for d in dates}
    devices, oses, brs, srcs, pages = {}, {}, {}, {}, {}
    all_uv, recent = set(), []
    total = 0

    # 天数少时逐日 list（请求更小）；跨度大时一次性 list 整个前缀
    prefixes = [STATS_PREFIX + d + '/' for d in dates] if days <= 31 else [STATS_PREFIX]
    keys = []
    for p in prefixes:
        try:
            keys.extend(_ls(p))
        except Exception:
            pass

    for k in keys:
        try:
            rest = k[len(STATS_PREFIX):]
            date, fname = rest.split('/', 1)
            if date not in want:
                continue
            parts = fname.split('~')
            if len(parts) < 7:
                continue
            hms, vid, dev, os_, br, src_b, path_b = parts[:7]
            src = _b64u_dec(src_b)
            path = _b64u_dec(path_b)
            total += 1
            daily[date]['pv'] += 1
            daily[date]['uv'].add(vid)
            all_uv.add(vid)
            devices[dev] = devices.get(dev, 0) + 1
            oses[os_] = oses.get(os_, 0) + 1
            brs[br] = brs.get(br, 0) + 1
            srcs[src] = srcs.get(src, 0) + 1
            pages[path] = pages.get(path, 0) + 1
            recent.append({'t': date + ' ' + hms[:2] + ':' + hms[2:4],
                           'dev': _DEV_NAME.get(dev, dev), 'os': _OS_NAME.get(os_, os_),
                           'br': _BR_NAME.get(br, br), 'src': src, 'path': path})
        except Exception:
            continue

    recent.sort(key=lambda x: x['t'], reverse=True)

    def _named(d, table):
        return sorted(([table.get(k, k), v] for k, v in d.items()), key=lambda x: -x[1])

    body = {
        'ok': True,
        'days': days,
        'total': total,
        'uv': len(all_uv),
        'today': {'pv': daily[today]['pv'], 'uv': len(daily[today]['uv'])},
        # 按时间正序返回，方便前端直接画折线
        'daily': [{'date': d, 'pv': daily[d]['pv'], 'uv': len(daily[d]['uv'])} for d in reversed(dates)],
        'devices': _named(devices, _DEV_NAME),
        'os': _named(oses, _OS_NAME),
        'browsers': _named(brs, _BR_NAME),
        'sources': _named(srcs, {})[:12],
        'pages': _named(pages, {})[:12],
        'recent': recent[:40],
    }
    return {'statusCode': 200, 'headers': H, 'body': json.dumps(body, ensure_ascii=False), 'isBase64Encoded': False}

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
    # 中转上传 / 预签名：二进制 body + query action（在解析 JSON 之前分流）
    q = event.get('queryString') or event.get('queryStringParameters') or {}
    action = str(q.get('action', '')).lower()
    if action == 'upload':
        try:
            return do_upload(event, q)
        except Exception as e:
            # 任何未捕获异常都返回 200+CORS，避免浏览器因缺 CORS 头而误报「跨域」
            return {'statusCode': 200, 'headers': H,
                    'body': json.dumps({'ok': False, 'err': 'SCF 内部错误：' + str(e)}, ensure_ascii=False),
                    'isBase64Encoded': False}
    if action == 'presign':
        try:
            return do_presign(event, q)
        except Exception as e:
            return {'statusCode': 200, 'headers': H,
                    'body': json.dumps({'ok': False, 'err': '预签名失败：' + str(e)}, ensure_ascii=False),
                    'isBase64Encoded': False}
    # 访客埋点：任何异常都吞掉，绝不影响前端渲染
    if action == 'visit':
        return do_visit(event, q)
    if action == 'stats':
        try:
            return do_stats(event, q)
        except Exception as e:
            return {'statusCode': 200, 'headers': H,
                    'body': json.dumps({'ok': False, 'err': '统计查询失败：' + str(e)}, ensure_ascii=False),
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
        # 新建「文件夹」：COS 无真文件夹，用 0 字节占位对象模拟（前缀即文件夹）
        if a == 'create_folder':
            key = (b.get('key') or '').strip()
            if not key:
                return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': '缺少 key'}, ensure_ascii=False), 'isBase64Encoded': False}
            try:
                _api('PUT', '/' + key, data=b'', headers={'Content-Length': '0'})
                return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True, 'key': key}, ensure_ascii=False), 'isBase64Encoded': False}
            except Exception as e:
                return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': str(e)}, ensure_ascii=False), 'isBase64Encoded': False}
        # 删除单个对象（原图 / 缩略图 / 视频封面）
        if a == 'delete_object':
            key = (b.get('key') or '').strip()
            if not key:
                return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': '缺少 key'}, ensure_ascii=False), 'isBase64Encoded': False}
            try:
                _api('DELETE', '/' + key)
                return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True, 'key': key}, ensure_ascii=False), 'isBase64Encoded': False}
            except Exception as e:
                return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': str(e)}, ensure_ascii=False), 'isBase64Encoded': False}
        # 删除整个文件夹（列出前缀下所有对象并并发删除）
        # 清空访客统计（可选传 before=YYYY-MM-DD 只清该日期之前的旧数据）
        if a == 'stats_clear':
            before = (b.get('before') or '').strip()
            ks = _ls(STATS_PREFIX)
            if before:
                ks = [k for k in ks if k[len(STATS_PREFIX):][:10] < before]
            def _rm_s(k):
                try:
                    _api('DELETE', '/' + k)
                    return True
                except Exception:
                    return False
            deleted = 0
            with ThreadPoolExecutor(max_workers=10) as ex:
                for ok in ex.map(_rm_s, ks):
                    deleted += 1 if ok else 0
            return {'statusCode': 200, 'headers': H, 'isBase64Encoded': False,
                    'body': json.dumps({'ok': True, 'total': len(ks), 'deleted': deleted}, ensure_ascii=False)}
        if a == 'delete_folder':
            p = (b.get('prefix') or '').strip()
            if not p:
                return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': '缺少 prefix'}, ensure_ascii=False), 'isBase64Encoded': False}
            ks = _ls(p)
            deleted = 0
            def _rm(k):
                try:
                    _api('DELETE', '/' + k)
                    return True
                except Exception:
                    return False
            with ThreadPoolExecutor(max_workers=10) as ex:
                for ok in ex.map(_rm, ks):
                    deleted += 1 if ok else 0
            return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': True, 'prefix': p, 'total': len(ks), 'deleted': deleted}, ensure_ascii=False), 'isBase64Encoded': False}
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': 'unknown action'}, ensure_ascii=False), 'isBase64Encoded': False}
    except Exception as e:
        return {'statusCode': 200, 'headers': H, 'body': json.dumps({'ok': False, 'err': str(e)}, ensure_ascii=False), 'isBase64Encoded': False}
