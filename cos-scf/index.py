# -*- coding: utf-8 -*-
"""
腾讯云 SCF（云函数）— COS 专栏文件夹同步服务
被前端在「改名专栏 / 移动图片」时调用，负责在桶里真正地：
  1) rename_folder：把 Photos/<old>/ 整目录复制到 Photos/<new>/ 并删旧
  2) move_object ：把 Photos/<from>/<file> 复制到 Photos/<to>/<file> 并删旧
凭证放在函数环境变量（不写在代码里），前端只持有本函数的 HTTPS 地址。
"""
import os
import json
from qcloud_cos import CosConfig, CosS3Client

SECRET_ID = os.environ.get('COS_SECRET_ID', '')
SECRET_KEY = os.environ.get('COS_SECRET_KEY', '')
BUCKET = os.environ.get('COS_BUCKET', 'miragedgeist-1463128155')
REGION = os.environ.get('COS_REGION', 'ap-guangzhou')

client = None
if SECRET_ID and SECRET_KEY:
    client = CosS3Client(CosConfig(Region=REGION, SecretId=SECRET_ID, SecretKey=SECRET_KEY))


def _list(prefix):
    keys = []
    marker = ''
    while True:
        r = client.list_objects(Bucket=BUCKET, Prefix=prefix, Marker=marker, MaxKeys=1000)
        for c in r.get('Contents', []):
            keys.append(c['Key'])
        if r.get('IsTruncated') == 'true':
            marker = r['NextMarker']
        else:
            break
    return keys


def _copy(src_key, dst_key):
    client.copy_object(Bucket=BUCKET, Key=dst_key,
                       CopySource={'Bucket': BUCKET, 'Key': src_key, 'Region': REGION})
    # 校验目标存在
    assert client.head_object(Bucket=BUCKET, Key=dst_key).get('ETag'), 'copy failed: ' + dst_key


def rename_folder(old, new):
    if not old or not new or old == new:
        return {'ok': True, 'skipped': True}
    old_p = 'Photos/%s/' % old
    new_p = 'Photos/%s/' % new
    keys = _list(old_p)
    copied = 0
    for k in keys:
        fname = k.split('/')[-1]
        _copy(k, new_p + fname)
        copied += 1
    # 删旧
    deleted = 0
    for k in keys:
        try:
            client.delete_object(Bucket=BUCKET, Key=k)
            deleted += 1
        except Exception:
            pass
    return {'ok': True, 'copied': copied, 'deleted': deleted}


def move_object(frm, to, fname):
    if not fname:
        return {'ok': False, 'err': 'missing filename'}
    if frm == to:
        return {'ok': True, 'skipped': True}
    src = 'Photos/%s/%s' % (frm, fname)
    dst = 'Photos/%s/%s' % (to, fname)
    if not client.head_object(Bucket=BUCKET, Key=src).get('ETag'):
        return {'ok': False, 'err': 'source not found: ' + src}
    _copy(src, dst)
    try:
        client.delete_object(Bucket=BUCKET, Key=src)
    except Exception:
        pass
    return {'ok': True, 'src': src, 'dst': dst}


def main_handler(event, context):
    if client is None:
        return {'statusCode': 500, 'body': json.dumps({'ok': False, 'err': 'COS 凭证未配置'})}
    try:
        # API 网关（腾讯云）body 可能是 str
        body = event.get('body', '{}')
        if isinstance(body, str):
            body = json.loads(body)
        action = body.get('action')
        if action == 'rename_folder':
            res = rename_folder(body.get('old'), body.get('new'))
        elif action == 'move_object':
            res = move_object(body.get('from'), body.get('to'), body.get('file'))
        else:
            res = {'ok': False, 'err': 'unknown action: ' + str(action)}
        return {'statusCode': 200, 'body': json.dumps(res, ensure_ascii=False)}
    except Exception as e:
        return {'statusCode': 200, 'body': json.dumps({'ok': False, 'err': str(e)}, ensure_ascii=False)}
