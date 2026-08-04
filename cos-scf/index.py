# -*- coding: utf-8 -*-
"""腾讯云 SCF（事件函数）— COS 专栏文件夹同步。
用「事件函数 + 函数 URL（公网）」部署，免 API 网关触发（旧网关已迁移不可用）。
前端改名/移动图片时 POST 调用本函数。"""
import os, json
from qcloud_cos import CosConfig, CosS3Client

SECRET_ID = os.environ.get('COS_SECRET_ID', '')
SECRET_KEY = os.environ.get('COS_SECRET_KEY', '')
BUCKET = os.environ.get('COS_BUCKET', 'miragedgeist-1463128155')
REGION = os.environ.get('COS_REGION', 'ap-guangzhou')
client = CosS3Client(CosConfig(Region=REGION, SecretId=SECRET_ID, SecretKey=SECRET_KEY)) if SECRET_ID else None


def _ls(prefix):
    ks, m = [], ''
    while True:
        r = client.list_objects(Bucket=BUCKET, Prefix=prefix, Marker=m, MaxKeys=1000)
        ks += [c['Key'] for c in r.get('Contents', [])]
        if r.get('IsTruncated') == 'true':
            m = r['NextMarker']
        else:
            break
    return ks


def _resp(code, obj):
    # Web 函数 / API 网关 都认这个返回格式；带 CORS 头以支持浏览器跨域调用
    return {
        'statusCode': code,
        'headers': {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST,OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
        'body': json.dumps(obj, ensure_ascii=False),
        'isBase64Encoded': False,
    }


def main_handler(event, context):
    # 浏览器跨域 POST 会先发 OPTIONS 预检，直接放行
    if str(event.get('httpMethod', '')).upper() == 'OPTIONS':
        return _resp(200, {'ok': True})
    if client is None:
        return _resp(500, {'ok': False, 'err': 'COS 凭证未配置'})
    try:
        b = event.get('body', '{}')
        if isinstance(b, str):
            b = json.loads(b)
        a = b.get('action')
        if a == 'rename_folder':                 # 整目录改名：复制后删旧
            o, n = 'Photos/%s/' % b['old'], 'Photos/%s/' % b['new']
            for k in _ls(o):
                client.copy_object(Bucket=BUCKET, Key=n + k.split('/')[-1],
                                   CopySource={'Bucket': BUCKET, 'Key': k, 'Region': REGION})
            for k in _ls(o):
                client.delete_object(Bucket=BUCKET, Key=k)
            return _resp(200, {'ok': True})
        if a == 'move_object':                   # 单图移动：复制后删旧
            s = 'Photos/%s/%s' % (b['from'], b['file'])
            d = 'Photos/%s/%s' % (b['to'], b['file'])
            client.copy_object(Bucket=BUCKET, Key=d, CopySource={'Bucket': BUCKET, 'Key': s, 'Region': REGION})
            client.delete_object(Bucket=BUCKET, Key=s)
            return _resp(200, {'ok': True})
        return _resp(200, {'ok': False, 'err': 'unknown action'})
    except Exception as e:
        return _resp(200, {'ok': False, 'err': str(e)})
