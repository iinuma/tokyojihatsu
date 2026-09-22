# 審査用スクリーンショット

シミュレータの automation API（`GET /api/screenshot/glasses`）で撮影。
審査ガイドラインの「capture them via the simulator's screenshot function」に従う。

## 撮り方

```bash
npm run app:dev
npx evenhub-simulator "http://localhost:5175/?lat=35.6569&lng=139.7547" --automation-port 9898
curl -o shot.png http://127.0.0.1:9898/api/screenshot/glasses
```

座標は**大門**（都営浅草線・大江戸線）。チャレンジ限定ライセンスが
2027-03-12 で切れても、基本ライセンスだけで同じ画が撮れる場所を選んでいる。

`?lat=&lng=` で現在地を渡している。**シミュレータは位置情報 API を持たない**
（`getAppLocation` は unknown variant で失敗する）ため、これがないと
「現在地が取れません」の画面しか撮れない。IMU も同様に未対応なので、
見上げ表示の挙動は実機でしか確認できない。

操作は `POST /api/input`（`click` / `down` / `context_menu` など）で行う。

## RGBA のまま保存すること

G2 の framebuffer は背景も文字も純緑で、**RGB に落とすと両者が潰れる**。
明るさ（textColor 0〜4）はアルファチャンネルに出る。見るときは黒に合成する:

```bash
magick 03-countdown.png -background black -alpha remove -alpha off view.png
```

## 一覧

| ファイル | 画面 |
| --- | --- |
| 01-stations.png | 近くの駅（大門 50m） |
| 02-directions.png | 方面の選択 |
| 03-countdown.png | カウントダウン（主画面） |
| 04-menu.png | コンテキストメニュー |
| 05-about.png | データについて（ODPT の必須表示） |
