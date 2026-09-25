/**
 * Web メルカトルのタイル座標計算。
 *
 * 地図タイルと、その上に重ねる印（現在地・駅）で**同じ式を使う**のが肝。
 * 別々の計算にすると必ずずれるし、ずれた地図は地図として役に立たない。
 *
 *   緯度経度 ─┬→ タイル座標 → 取得して切り出す
 *             └→ 同じ式で画素位置 → 印を描く
 */

import type { LatLng } from './geo.js';

export const TILE_SIZE = 256;

/** 地図全体を 1 枚の巨大な画像と見たときの画素座標。 */
export interface WorldPixel {
  px: number;
  py: number;
}

export function toWorldPixel(point: LatLng, zoom: number): WorldPixel {
  const scale = 2 ** zoom * TILE_SIZE;
  const latRad = (point.lat * Math.PI) / 180;
  return {
    px: ((point.lng + 180) / 360) * scale,
    py: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * scale,
  };
}

/** そのズームで 1 画素が何メートルか。緯度で変わる。 */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** zoom;
}

export interface TileRef {
  x: number;
  y: number;
  z: number;
}

export interface TileWindow {
  zoom: number;
  /** 切り出す窓の左上（世界画素座標）。 */
  left: number;
  top: number;
  width: number;
  height: number;
  /** 必要なタイルの範囲。 */
  tiles: TileRef[];
  /** タイルを並べた画像の中で、窓の左上がどこに来るか。 */
  offsetX: number;
  offsetY: number;
  /** 並べた画像の大きさ（タイル数）。 */
  columns: number;
  rows: number;
}

/**
 * 指定した点を中心に、width x height の窓を切り出すのに必要なタイルを求める。
 */
export function tileWindow(
  center: LatLng,
  zoom: number,
  width: number,
  height: number,
): TileWindow {
  const { px, py } = toWorldPixel(center, zoom);
  const left = px - width / 2;
  const top = py - height / 2;

  const tx0 = Math.floor(left / TILE_SIZE);
  const ty0 = Math.floor(top / TILE_SIZE);
  // 窓の右端・下端が載っているタイルまで含める。端がちょうど境界のときに
  // 1 枚多く取らないよう、最後の画素（-1）で判定する。
  const tx1 = Math.floor((left + width - 1) / TILE_SIZE);
  const ty1 = Math.floor((top + height - 1) / TILE_SIZE);

  const tiles: TileRef[] = [];
  for (let y = ty0; y <= ty1; y += 1) {
    for (let x = tx0; x <= tx1; x += 1) {
      tiles.push({ x, y, z: zoom });
    }
  }

  return {
    zoom,
    left,
    top,
    width,
    height,
    tiles,
    offsetX: Math.round(left - tx0 * TILE_SIZE),
    offsetY: Math.round(top - ty0 * TILE_SIZE),
    columns: tx1 - tx0 + 1,
    rows: ty1 - ty0 + 1,
  };
}

/** 窓の中での画素位置。窓の外なら負や範囲超えの値がそのまま返る。 */
export function toWindowPixel(point: LatLng, window: TileWindow): { x: number; y: number } {
  const { px, py } = toWorldPixel(point, window.zoom);
  return { x: px - window.left, y: py - window.top };
}

/**
 * 地理院タイルの URL。
 *
 * 地理院サーバーから**リアルタイムに読み込んで表示する**限り、申請不要・
 * 出典の明示のみで使える。キャッシュして配り直すと「複製」になり話が変わるので、
 * 取得はそのつど直接行う。
 *
 * 出典表示の義務: 「国土地理院」＋ 地理院タイル一覧ページへのリンク。
 * 加工して使う場合は、出典とは別に加工した旨も書く。
 */
export function gsiTileUrl(tile: TileRef, style = 'pale'): string {
  return `https://cyberjapandata.gsi.go.jp/xyz/${style}/${tile.z}/${tile.x}/${tile.y}.png`;
}

export const GSI_TILE_HOST = 'https://cyberjapandata.gsi.go.jp';
export const GSI_ATTRIBUTION = '出典: 国土地理院（地理院タイルを加工して使用）';
