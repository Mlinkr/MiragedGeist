# -*- coding: utf-8 -*-
"""腾讯云 SCF — COS 专栏文件夹同步（事件函数）。前端改名/移动图片时调用。"""
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


def main_handler(event, context):
    if client is None:
        return {'statusCode': 500, 'body': json.dumps({'ok': False, 'err': 'COS 凭证未配置'})}
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
            return {'statusCode': 200, 'body': json.dumps({'ok': True})}
        if a == 'move_object':                   # 单图移动：复制后删旧
            s = 'Photos/%s/%s' % (b['from'], b['file'])
            d = 'Photos/%s/%s' % (b['to'], b['file'])
            client.copy_object(Bucket=BUCKET, Key=d, CopySource={'Bucket': BUCKET, 'Key': s, 'Region': REGION})
            client.delete_object(Bucket=BUCKET, Key=s)
            return {'statusCode': 200, 'body': json.dumps({'ok': True})}
        return {'statusCode': 200, 'body': json.dumps({'ok': False, 'err': 'unknown action'})}
    except Exception as e:
        return {'statusCode': 200, 'body': json.dumps({'ok': False, 'err': str(e)})}
