/**
 * Lambda Function URL のエントリ。
 * 中継の中身は proxy.ts にあり、こちらは AWS のイベント形式との橋渡しだけ。
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { handleProxyRequest } from './proxy.js';
import { resolveAppKey, resolveToken } from './token.js';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const [token, appKey] = await Promise.all([resolveToken(), resolveAppKey()]);

  // ヘッダ名の大文字小文字は経路によって変わるので、小文字に揃える。
  const headers: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(event.headers ?? {})) {
    headers[key.toLowerCase()] = value;
  }

  const response = await handleProxyRequest(
    {
      path: event.rawPath ?? '/',
      query: event.queryStringParameters ?? {},
      method: event.requestContext?.http?.method ?? 'GET',
      headers,
      sourceIp: event.requestContext?.http?.sourceIp,
    },
    { token, appKey },
  );

  return { statusCode: response.status, headers: response.headers, body: response.body };
}
