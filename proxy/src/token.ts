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

let cached: string | null = null;
let client: SSMClient | null = null;

export async function resolveToken(): Promise<string> {
  if (cached) return cached;

  const direct = process.env.ODPT_TOKEN;
  if (direct) {
    cached = direct;
    return direct;
  }

  const parameterName = process.env.ODPT_TOKEN_PARAM;
  if (!parameterName) return '';

  client ??= new SSMClient({});
  const result = await client.send(
    new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
  );

  const value = result.Parameter?.Value ?? '';
  if (value) cached = value;
  return value;
}

/** テスト用。 */
export function resetTokenCache(): void {
  cached = null;
}
