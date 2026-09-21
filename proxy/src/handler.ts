/**
 * Lambda Function URL のエントリ。
 * 中継の中身は proxy.ts にあり、こちらは AWS のイベント形式との橋渡しだけ。
 */

import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';

import { handleProxyRequest } from './proxy.js';
import { resolveToken } from './token.js';

export async function handler(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  const token = await resolveToken();

  const response = await handleProxyRequest(
    {
      path: event.rawPath ?? '/',
      query: event.queryStringParameters ?? {},
      method: event.requestContext?.http?.method ?? 'GET',
    },
    { token },
  );

  return { statusCode: response.status, headers: response.headers, body: response.body };
}
