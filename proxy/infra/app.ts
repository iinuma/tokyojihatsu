#!/usr/bin/env node
/**
 * CDK のエントリ。
 *
 *   npx cdk deploy -c tokenParam=/tokyojihatsu/odpt-token
 *
 * トークンは事前に SSM へ置いておく（値はここにもテンプレートにも残らない）:
 *   aws ssm put-parameter --name /tokyojihatsu/odpt-token --type SecureString --value '...'
 */

import { App } from 'aws-cdk-lib';
import { TokyojihatsuProxyStack } from './stack.js';

const app = new App();

const tokenParameterName =
  app.node.tryGetContext('tokenParam') ?? '/tokyojihatsu/odpt-token';

new TokyojihatsuProxyStack(app, 'TokyojihatsuProxyStack', {
  tokenParameterName,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1',
  },
  description: '東京次発: ODPT 中継（API キー秘匿とデータ更新義務のため）',
});
