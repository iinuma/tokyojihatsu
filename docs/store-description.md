# ストア掲載文（Even Hub ポータル → Edit description）

## About（2000 文字以内）

Even Hub の About は**日英 1 フィールド**で、合計 2000 文字まで。現状 1966 文字。
英語は同じ内容に日本語の約 2.5 倍の文字数を要するので、**対訳ではなく要点を絞った版**
にしてある。削ったのは「使い方」の手順と事業者名の一部で、ODPT 開発者ガイドライン
3.1 が求める 3 点（提供元・無保証・問い合わせ先）は**両言語に残してある**。

⚠️ **審査中は Store listing を編集できない。** 提出前に正しくしておくこと。
0.3.2 の掲載文は「遅延は反映されません」のまま公開され、v0.4.0 で遅延に対応した
あとも審査が明けるまで直せなかった。

```
スマートフォンを取り出さずに、次の電車まであと何分かを確認できます。

■ 使い方
1. 近くの駅を選ぶ
2. 路線・方面を選ぶ
3. 発車までの残り時間が表示されます

一度選べば記憶します。同じ駅なら起動するだけで始まり、駅はメニューから選び直せます。

■ 見上げたときだけ表示
初期設定では、視線を下げると駅名とカウントダウンが消え、見上げると戻ります。歩行中や会話中に視界を占有しません。時計は常に表示したままで、常時表示にも切り替えられます。

■ 遅れているとき
遅延情報が提供されている路線では、発車時刻の横に遅れと、その情報を確認した時刻を表示します。東京メトロなど提供していない事業者の路線では表示されません。

■ 対応範囲
東京メトロ／都営地下鉄（都電荒川線・日暮里舎人ライナーを含む）／横浜市営地下鉄／つくばエクスプレス／多摩都市モノレール／ゆりかもめ／りんかい線

加えて、公共交通オープンデータチャレンジ2026の期間中（2027年3月12日まで）は、JR東日本・京急・東急・京王・小田急・西武・東武・相鉄にも対応します。期間終了後は対象駅が変わります。

■ データについて
時刻表データと遅延情報は公共交通オープンデータセンターの提供です。データの正確性・完全性が保証されたものではありません。表示は時刻表上の予定時刻で、遅延情報がある路線ではそれを加えて表示します。取得日時はアプリ内で確認できます。

近くの駅を出すために位置情報を使います。端末内だけで処理され、外部へ送信されません。

本アプリが表示する情報について、公共交通事業者への直接のお問い合わせはご遠慮ください。下記までご連絡ください。

---

Tokyojihatsu counts down to the next train on your Even G2, so you don't have to take out your phone. Pick a nearby station, then a line and direction; your choice is remembered.

■ Shown only when you look up
By default the station name and countdown hide when you look down and return when you look up, so they stay out of your way as you walk or talk. The clock is always visible. Always-on is in the menu.

■ Coverage
Tokyo Metro, Toei Subway, Yokohama Municipal Subway, Tsukuba Express, Tama Monorail, Yurikamome and the Rinkai Line, plus JR East, Keikyu, Tokyu, Keio, Odakyu, Seibu, Tobu and Sotetsu until 12 March 2027 under the Open Data Challenge for Public Transportation 2026.

■ About the data
Timetable and delay data is provided by the Open Data Center for Public Transportation; accuracy and completeness are not guaranteed. Times shown are scheduled departures, with published delays and the time they were checked added where an operator provides them (Tokyo Metro does not). Your location is used only to find nearby stations and never leaves the phone. Please do not contact transit operators about this app.

Contact: async.sync+tokyojihatsu@gmail.com
Privacy policy: https://iinuma.github.io/tokyojihatsu/privacy-policy
```

ODPT 開発者ガイドライン 3.1 が求める 3 点（提供元・無保証・問い合わせ先）を
ここにも書いている。アプリ内の「データについて」にも同じ内容がある。

## Tags（5 個まで）

```
電車, 時刻表, 東京, train, timetable
```

Even Hub は全世界に公開されるので、日本語と英語を混ぜる。

## Category

ポータルの選択肢から選ぶ。交通・移動系が無ければ Utility / Tools 相当。
