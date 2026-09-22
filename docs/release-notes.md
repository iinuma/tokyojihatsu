# リリースノート

Even Hub の審査では `supported_languages` ごとに必要。1〜3 行、コードの変更では
なく利用者にとって何が変わったかを書く。初版はアプリの説明にする。

## tagline（ポータルのプロジェクト設定・50 文字以内）

```
首都圏の駅で、見上げれば次の電車まであと何分か
```

23 文字。体験（見上げる）と対応範囲（首都圏）の両方を入れている。
見上げ表示が既定なので、実際の振る舞いとも一致する。

駅数や事業者名は書かない。チャレンジ限定ライセンスのデータが 2027-03-12 で
切れると 1844 駅 → 440 駅に戻るうえ、Submitted 以降はメタデータを編集
できないため、数字を書くと実態とずれたまま直せなくなる。「首都圏」なら
期限の前後どちらでも成り立つ。

## 0.2.0

### ja

```
近くの駅と方面を選ぶと、次の電車の発車時刻までの残り時間をG2に表示します。
JR・私鉄・地下鉄に対応し、スマホを取り出さずにあと何分かを確認できます。
```

### en

```
Pick a nearby station and direction, then see the countdown to the next train on your G2.
Covers JR, private railways and subways in the Tokyo area.
```

## 0.1.1（初版として提出する場合）

### ja

```
近くの駅と方面を選ぶと、次の電車の発車時刻までの残り時間をG2に表示します。
スマホを取り出さずに、あと何分かだけを確認できます。
東京メトロ・都営など7事業者440駅に対応しています。
```

### en

```
Pick a nearby station and direction, then see the countdown to the next train on your G2.
Check how long you have without taking out your phone.
Covers 440 stations across 7 operators in the Tokyo area.
```
