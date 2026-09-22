/**
 * 東京次発のプロキシ。Lambda Function URL 1 本だけの小さな構成。
 *
 * 置くものを増やしていないのは、この層の役目が中継とキャッシュ指示だけだから。
 * 時刻表そのものは持たず、都度 ODPT を引く。そうすればデータ更新義務
 * （更新通知から 1 週間以内）が構成上自動で満たされる。
 */

import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { FunctionUrlAuthType } from 'aws-cdk-lib/aws-lambda';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));

export interface ProxyStackProps extends StackProps {
  /** ODPT トークンを入れた SSM パラメータ名（SecureString）。 */
  tokenParameterName: string;
  /** アプリとの共有鍵を入れた SSM パラメータ名（SecureString）。 */
  appKeyParameterName: string;
  /**
   * チャレンジ限定ライセンス用トークンの SSM パラメータ名（SecureString）。
   * 省略すると /challenge/ 以下は 404 を返す。
   */
  challengeTokenParameterName?: string;
}

export class TokyojihatsuProxyStack extends Stack {
  constructor(scope: Construct, id: string, props: ProxyStackProps) {
    super(scope, id, props);

    // ログは 1 週間で捨てる。中継の障害切り分け以上の用途がない。
    const logGroup = new LogGroup(this, 'OdptProxyLogs', {
      retention: RetentionDays.ONE_WEEK,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const fn = new NodejsFunction(this, 'OdptProxy', {
      entry: resolve(here, '../src/handler.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      memorySize: 256,
      timeout: Duration.seconds(15),
      logGroup,
      environment: {
        // 値ではなくパラメータ名だけを渡す。テンプレートにキーを残さないため。
        ODPT_TOKEN_PARAM: props.tokenParameterName,
        APP_KEY_PARAM: props.appKeyParameterName,
        ...(props.challengeTokenParameterName
          ? { ODPT_CHALLENGE_TOKEN_PARAM: props.challengeTokenParameterName }
          : {}),
      },
      bundling: {
        format: undefined,
        minify: true,
        sourceMap: false,
        // AWS SDK は Lambda ランタイムに同梱されているのでバンドルしない。
        externalModules: ['@aws-sdk/*'],
      },
    });

    // パラメータは別途 aws ssm put-parameter で作る。CDK では参照だけする。
    const parameter = StringParameter.fromSecureStringParameterAttributes(this, 'OdptToken', {
      parameterName: props.tokenParameterName,
    });
    parameter.grantRead(fn);

    const appKeyParameter = StringParameter.fromSecureStringParameterAttributes(this, 'AppKey', {
      parameterName: props.appKeyParameterName,
    });
    appKeyParameter.grantRead(fn);

    if (props.challengeTokenParameterName) {
      const challengeParameter = StringParameter.fromSecureStringParameterAttributes(
        this,
        'ChallengeToken',
        { parameterName: props.challengeTokenParameterName },
      );
      challengeParameter.grantRead(fn);
    }

    const url = fn.addFunctionUrl({
      // 公開アプリから叩くので認証は付けない。扱えるデータ型とクエリを
      // proxy.ts 側で絞ってあり、キーは外に出ない。
      authType: FunctionUrlAuthType.NONE,
      // CORS は Function URL 側では設定しない。
      // ここで設定すると AWS が付けるヘッダとハンドラが返すヘッダが重なり、
      // Access-Control-Allow-Origin が 2 つ返る。ブラウザは複数あると
      // 仕様上エラーにするので、WebView からの fetch が Load failed で落ちる（実機で遭遇）。
      // 応答の組み立てはハンドラ側に一本化する（テストもそちらにある）。
    });

    new CfnOutput(this, 'ProxyUrl', {
      value: url.url,
      description: 'app.json の whitelist と VITE_ODPT_PROXY に設定する URL',
    });
  }
}
