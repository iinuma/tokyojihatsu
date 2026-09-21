# 実機検証プラグイン（probe）

東京次発の本体ではない。**G2 の実機でしか決まらないことを数字で残すためだけ**のアプリ。
カウントダウンは入っていない。

## 何を確かめるか

Notion 要件の「実機でのみ確認できること」に対応する。

| # | 確かめること | probe のどこに出るか |
|---|---|---|
| 1 | iPhone をロックして数分置くと JS は止まるのか。止まるなら何秒か | `sdk stop:` / `raw stop:` の行 |
| 2 | 止まったとき、どの保存先が生き残るか | `store web:? host:?` |
| 3 | 位置情報の stream は止まるのか、復帰するのか | `loc` の行（件数と最終更新からの経過） |
| 4 | 前面時に見上げる・外す・画面が消えると何のイベントが来るか | ログ画面（`fg-enter` / `fg-exit` など） |
| 5 | 見上げ検出を IMU で自作できそうか | `imu x y z`（頭を上下して値の変化を見る） |
| 6 | 日本語のグリフが firmware のフォントにあるか | `JP:` の行。空白になったら無い |
| 7 | G2 メニューから起動するまで何操作か | 人が数える。`launch` に起動経路が出る |

### タイマーを 2 系統測っている理由

SDK は読み込み時に `setInterval` を差し替える（コンソールに `[ShadowTimers] ... queued` が出る）。
この挙動は公式ドキュメントに記載がない。そのため「タイマーが飛んだ」だけでは

- WebView 自体が suspend された
- SDK の shadow timer がキューに溜めていただけ

のどちらか分からない。probe は SDK を読み込む前の素の `setInterval` も保持して
（[src/raw-timers.ts](src/raw-timers.ts)）両方のギャップを別々に測る。

- `sdk` と `raw` の**両方**が同じだけ飛ぶ → WebView ごと止まっていた
- `sdk` だけ飛ぶ → SDK がキューに溜めていた

## 重要: ロック検証は Beta build でしかできない

公式ドキュメントの明記。検証モードを取り違えると、答えの出ない検証に時間を使うことになる。

| モード | ロック 5 分の検証 | 備考 |
|---|---|---|
| シミュレータ | **不可** | 「backgrounding、実際の権限、BLE のタイミングは実機でないと検証できない」 |
| Local Testing（QR） | **不可** | ロックした瞬間に WebView が suspend され、dev の WebSocket が死ぬ。復帰後は白画面で、QR を読み直すことになる |
| Private build | **不十分** | 「survive backgrounding briefly but don't pass the 5-minute lock test」 |
| **Beta build** | **可** | 「the only mode that behaves identically to a Released app」。QA レビュアーが回すのもこれ |

つまり検証 #1〜#3 は Beta build まで持っていく必要がある。#4〜#7 は Local Testing で足りる。

## 手順

### 0. 一度だけ

1. [hub.evenrealities.com/login](https://hub.evenrealities.com/login) に、スマホアプリと**同じアカウント**でサインインする。
   これで開発者モードになる（アプリ側にトグルはない）。
2. Even Realities アプリを**強制終了**して開き直す。Even Hub タブの右上に開発者向けの区画が出る。
3. G2 をペアリングし、ファームウェアを更新しておく。

### 1. Local Testing（#4〜#7 用）

```bash
npm run probe:dev
```

別のターミナルで QR を出し、アプリの Scan QR で読む。

```bash
npm run probe:qr
```

LAN IP はデフォルト経路のインターフェースから取る（[scripts/lan-ip.sh](../scripts/lan-ip.sh)）。
Wi-Fi が `en0` とは限らない——Thunderbolt ブリッジなどがあると `ipconfig getifaddr en0` は
空を返すので、インターフェース名は決め打ちにしていない。

QR が読めても画面が出ないときは、Mac のファイアウォールで node の受信を許可する／
Wi-Fi の AP アイソレーションを疑う（テザリングに切り替えると切り分けられる）。

なお probe は HMR を当てにしない。コードを書き換えてリロードが走ると計測がリセットされる
ので、計測中はむしろ繋がっていないほうがよい。

### 2. Beta build（#1〜#3 用）

```bash
npm run probe:pack     # ビルド → dist/tokyojihatsu-probe.ehpk
```

開発者ポータルで Beta group（自分だけの `self-test` でよい）を作り、`.ehpk` を
アップロードしてそのグループに push する。スマホの Me → Beta tester から Install。

そのうえで:

1. probe を起動して画面が出ていることを確認する
2. **スマホをロックして 5 分待つ**
3. ロックを解除して probe の画面を見る

読むところ:

- `sdk stop:` と `raw stop:` に 5 分前後のギャップが出ていれば、**WebView は止まっていた**。
  どちらも `none` のままなら止まっていない（＝ Background & Lifecycle の記述が正しい）。
- `boot#` が増えていたら、復帰ではなく**再起動**している（in-memory は失われる）。
- `store web:y host:y` なら両方の保存先から復元できている。
- ログ画面（タップで切替）に `fg-exit` / `fg-enter` が出ていれば、前面・背面の遷移が
  イベントとして取れる。

結果は Notion の「未解決事項・実機検証」に書き戻す。

## 操作

| 操作 | 動き |
|---|---|
| タップ | サマリ ⇄ ログの切替 |
| 上下スワイプ | ログのページ送り |
| タップしてから長押し | OS のコンテキストメニュー（Clear log / Dump to console / Exit） |

`Dump to console` は全ログを `console.log` に流す。実機のコンソールは
スマホアプリの開発者モード画面から読める。

## ブラウザだけで動かす

ホストが居なくても落ちないようにしてある。`npm run probe:dev` して
`http://localhost:5173` を開くと、同じ内容が DOM に出る（`bridge:n` と表示される）。
表示崩れやロジックの確認はここでできる。
