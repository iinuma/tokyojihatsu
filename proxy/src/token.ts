/**
 * ODPT トークンの取得。
 *
 * CloudFormation のテンプレートにキーを残したくないので、SSM パラメータストアの
 * SecureString から実行時に読む（標準パラメータは無料）。Lambda の実行環境は
 * 使い回されるので、一度読んだらモジュールスコープに持っておく。
 *
 * ローカルで動かすときは環境変数 ODPT_TOKEN を見る。
 */

import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const cache = new Map<string, string>();
let client: SSMClient | null = null;

async function resolve(envName: string, paramEnvName: string): Promise<string> {
  const hit = cache.get(envName);
  if (hit) return hit;

  const direct = process.env[envName];
  if (direct) {
    cache.set(envName, direct);
    return direct;
  }

  const parameterName = process.env[paramEnvName];
  if (!parameterName) return '';

  client ??= new SSMClient({});
  const result = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );

  const value = result.Parameter?.Value ?? '';
  if (value) cache.set(envName, value);
  return value;
}

/** ODPT の consumerKey。 */
export function resolveToken(): Promise<string> {
  return resolve('ODPT_TOKEN', 'ODPT_TOKEN_PARAM');
}

/**
 * アプリとの共有鍵。未設定なら空を返し、そのときは鍵の検査をしない
 * （ローカル開発のため）。
 */
export function resolveAppKey(): Promise<string> {
  return resolve('APP_KEY', 'APP_KEY_PARAM');
}

/** テスト用。 */
export function resetTokenCache(): void {
  cache.clear();
}
