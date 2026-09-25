/**
 * 近くの駅を模式図として描く。
 *
 * タイル地図は使わない。G2 は透過ディスプレイで、塗られた面はそのまま視界を
 * 塞ぐ。タイルは面が塗られているので、地図としては読めても前が見えなくなる。
 * 駅の緯度経度は手元にある（stations.json に 1844 駅）ので、取りに行く必要もない。
 *
 * 答えたい問いは 1 つだけ。**どっちの方向にどの駅があるか**。
 * 正確な距離はリスト側が数字で出しているので、ここで重ねて示す必要はない。
 *
 * その割り切りから、設計が 3 つ決まる。
 *
 *   1. **現在地は常に中心**。外接矩形に合わせると、いる場所によって自分の
 *      位置が動いて読み方が毎回変わる。中心固定なら「真ん中が自分」だけ覚えればよい。
 *   2. **半径は平方根で圧縮する**。近傍駅は 69m から 1km まで 15 倍の幅があり、
 *      線形だと近い駅が全部중心に潰れる（実際に潰れた）。sqrt を挟むと近くが開き、
 *      遠くが詰まる。**方向と近い順は完全に保たれ、狂うのは絶対距離だけ**で、
 *      それはリストが持っている。
 *   3. **路線の線は引かない**。駅の並び順を持っていないので、座標順に結ぶと
 *      実際の経路と無関係な折れ線になる（蜘蛛の巣になった）。代わりに
 *      現在地から選択駅へ 1 本だけ引く。これは常に正しく、知りたいことそのもの。
 *
 * 文字は入れない。ビットマップにフォントを持つ必要が出るうえ、288x144 に
 * 日本語を焼き込んでも読めない。駅名は隣のテキストコンテナに出す。
 */

import { Bitmap, LEVEL } from './bitmap.js';
import { distanceMeters, type LatLng } from './geo.js';

export interface MapStation extends LatLng {
  /** 駅の識別子。同名・近接のホームはまとめた「駅」の単位で渡す。 */
  id: string;
  name: string;
}

export interface StationMapOptions {
  width: number;
  height: number;
  /** 現在地。地図の中心になる。 */
  origin: LatLng;
  stations: readonly MapStation[];
  /** 強調する駅の id。リストで選択中のもの。 */
  selectedId?: string | null;
  /** 縁の余白（画素）。印が切れないように取る。 */
  margin?: number;
  /**
   * 半径の圧縮。1 で線形（実距離どおり）、0.5 で平方根。
   * 既定は 0.5。小さいほど近くの駅が開く。
   */
  radiusExponent?: number;
}

export interface PlottedStation {
  station: MapStation;
  x: number;
  y: number;
  distanceMeters: number;
}

export interface StationMapResult {
  bitmap: Bitmap;
  plotted: PlottedStation[];
  /** いちばん遠い駅までの距離。縮尺の説明をテキスト側に出すときに使う。 */
  rangeMeters: number;
}

/**
 * 正距円筒図法。範囲が数 km なのでこれで十分正しい。
 * 経度は緯度で縮むので cos を掛ける。掛けないと東京付近で約 1.2 倍横に伸びる。
 */
function offsetFrom(origin: LatLng, point: LatLng): { dx: number; dy: number } {
  return {
    dx: (point.lng - origin.lng) * Math.cos((origin.lat * Math.PI) / 180),
    dy: -(point.lat - origin.lat), // 北を上にするので反転
  };
}

/**
 * 中心から見て角度 theta の方向に、矩形の縁まで何画素あるか。
 *
 * 円に合わせると 2:1 の画面では左右が大きく余る。矩形の縁まで使うと
 * 東西方向により広い範囲が入り、288x144 を無駄なく使える。
 */
function radiusToEdge(theta: number, halfWidth: number, halfHeight: number): number {
  const cos = Math.abs(Math.cos(theta));
  const sin = Math.abs(Math.sin(theta));
  const EPSILON = 1e-9;
  return Math.min(
    cos < EPSILON ? Number.POSITIVE_INFINITY : halfWidth / cos,
    sin < EPSILON ? Number.POSITIVE_INFINITY : halfHeight / sin,
  );
}

export function renderStationMap(options: StationMapOptions): StationMapResult {
  const {
    width,
    height,
    origin,
    stations,
    selectedId = null,
    margin = 8,
    radiusExponent = 0.5,
  } = options;

  const bitmap = new Bitmap(width, height);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const halfWidth = Math.max(1, width / 2 - margin);
  const halfHeight = Math.max(1, height / 2 - margin);

  const measured = stations.map((station) => ({
    station,
    distance: distanceMeters(origin, station),
    ...offsetFrom(origin, station),
  }));

  const rangeMeters = measured.reduce((max, entry) => Math.max(max, entry.distance), 0);

  const plotted: PlottedStation[] = [];
  if (rangeMeters > 0) {
    for (const entry of measured) {
      const theta = Math.atan2(entry.dy, entry.dx);
      // 実距離の比を [0,1] に取り、指数で圧縮してから縁までの長さに乗せる。
      const ratio = Math.min(1, entry.distance / rangeMeters);
      const pixels = Math.pow(ratio, radiusExponent) * radiusToEdge(theta, halfWidth, halfHeight);

      plotted.push({
        station: entry.station,
        x: centerX + Math.cos(theta) * pixels,
        y: centerY + Math.sin(theta) * pixels,
        distanceMeters: entry.distance,
      });
    }
  }

  const selected = plotted.find((entry) => entry.station.id === selectedId) ?? null;

  // 1. 現在地から選択駅へ 1 本。これだけは常に正しく、知りたいことそのもの。
  if (selected) {
    bitmap.line(centerX, centerY, selected.x, selected.y, LEVEL.dim);
  }

  // 2. 駅の点。選択中以外は小さく。
  for (const entry of plotted) {
    if (entry === selected) continue;
    bitmap.disc(entry.x, entry.y, 2, LEVEL.mid);
  }

  // 3. 選択中の駅。塗りつぶさず輪で囲むと、線と重なっても形が残る。
  if (selected) {
    bitmap.disc(selected.x, selected.y, 2, LEVEL.bright);
    bitmap.ring(selected.x, selected.y, 6, LEVEL.bright);
    bitmap.ring(selected.x, selected.y, 7, LEVEL.bright);
  }

  // 4. 現在地。駅とは違う形にする。透過表示では、明るさの差より形の差のほうが
  //    確実に見分けられる。中心は空けておき、近い駅と重なっても潰れないようにする。
  bitmap.cross(centerX, centerY, 7, LEVEL.bright);
  bitmap.set(centerX, centerY, LEVEL.off);

  // 5. 北の印。左上に矢印。方位を進行方向に回すと首を振るたび画像を
  //    送り直すことになるので、北固定にしてある。
  const nx = margin;
  bitmap.line(nx, 3, nx, 13, LEVEL.mid);
  bitmap.line(nx, 3, nx - 3, 7, LEVEL.mid);
  bitmap.line(nx, 3, nx + 3, 7, LEVEL.mid);

  return { bitmap, plotted, rangeMeters };
}
