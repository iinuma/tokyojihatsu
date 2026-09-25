/**
 * G2 の画像コンテナへ送るビットマップ。
 *
 * 画像は 1 枚あたり **最大 288x144**（SDK の ImageContainerProperty: width 20~288,
 * height 20~144）。画面は 576x288 なので、右半分を全高で埋めたければ 2 枚積む。
 *
 * 階調は 16 段（Gray4）。ただし G2 は透過ディスプレイなので、**暗い＝透明＝
 * 現実が透ける**という関係になる。面を塗ると視界を塞ぐので、塗らずに線で描く。
 * 中間調は明るい屋外だと飛ぶため、実用上は明・中・暗の 3 段階として設計する。
 *
 * 送り方は 2 通りあり、宿主はおそらく**バイト数から判別**している
 * （w*h なら Gray8、w*h/2 なら Gray4、どちらでもなければ符号化画像として解釈）。
 * どちらが通るかは実機で確かめる。SDK 内部で LZ4 圧縮されるので、線画なら
 * 実際の転送量はここで計算した生バイト数よりかなり小さくなるはず。
 */

/** 明るさの段階。透過ディスプレイで実際に区別がつく範囲に寄せてある。 */
export const LEVEL = {
  off: 0,
  dim: 5,
  mid: 10,
  bright: 15,
} as const;

export const MAX_IMAGE_WIDTH = 288;
export const MAX_IMAGE_HEIGHT = 144;

/**
 * 1 画素 1 バイト（0〜15）で持つ描画面。
 *
 * パッキングは書き出しのときだけ行う。描いている途中でニブルを詰めると
 * 読み書きのたびにビット演算が要るうえ、どちらのニブルが先かを間違えると
 * 全体が横にずれるという分かりにくい壊れ方をする。
 */
export class Bitmap {
  readonly width: number;
  readonly height: number;
  private readonly pixels: Uint8Array;

  constructor(width: number, height: number) {
    if (!Number.isInteger(width) || !Number.isInteger(height)) {
      throw new Error('bitmap size must be integers');
    }
    if (width < 1 || height < 1) throw new Error('bitmap size must be positive');
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height);
  }

  /** 画面外の指定は黙って捨てる。地図は範囲外の点を描こうとするのが普通なので。 */
  set(x: number, y: number, level: number): void {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return;
    this.pixels[py * this.width + px] = Math.max(0, Math.min(15, Math.round(level)));
  }

  /**
   * set と同じく座標を丸める。片方だけ丸めると、中心が 143.5 のような
   * 小数になったとき「描いたのに読めない」という分かりにくい食い違いになる。
   */
  get(x: number, y: number): number {
    const px = Math.round(x);
    const py = Math.round(y);
    if (px < 0 || py < 0 || px >= this.width || py >= this.height) return 0;
    return this.pixels[py * this.width + px] ?? 0;
  }

  fill(level: number): void {
    this.pixels.fill(Math.max(0, Math.min(15, Math.round(level))));
  }

  /** Bresenham。線の太さは 1 画素。 */
  line(x0: number, y0: number, x1: number, y1: number, level: number): void {
    let ax = Math.round(x0);
    let ay = Math.round(y0);
    const bx = Math.round(x1);
    const by = Math.round(y1);

    const dx = Math.abs(bx - ax);
    const dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1;
    const sy = ay < by ? 1 : -1;
    let error = dx + dy;

    // 端点どうしが一致していても 1 画素は打つ。
    for (;;) {
      this.set(ax, ay, level);
      if (ax === bx && ay === by) break;
      const doubled = 2 * error;
      if (doubled >= dy) {
        error += dy;
        ax += sx;
      }
      if (doubled <= dx) {
        error += dx;
        ay += sy;
      }
    }
  }

  /**
   * 塗りつぶした円。駅の点に使う。半径 0 なら 1 画素。
   *
   * 判定に r を足してあるのは、半径 2〜3 の小さな円が
   * 厳密な r*r だと十字に見えてしまうため。駅の点はこの大きさで使う。
   */
  disc(cx: number, cy: number, radius: number, level: number): void {
    const r = Math.max(0, Math.round(radius));
    const limit = r * r + r;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (dx * dx + dy * dy <= limit) this.set(cx + dx, cy + dy, level);
      }
    }
  }

  /** 輪郭だけの円。塗りと区別したい印（現在地など）に使う。 */
  ring(cx: number, cy: number, radius: number, level: number): void {
    const r = Math.max(1, Math.round(radius));
    // 角度で打つと半径が小さいとき隙間が空くので、画素で判定する。
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance <= r + 0.5 && distance >= r - 0.5) this.set(cx + dx, cy + dy, level);
      }
    }
  }

  /** 十字。現在地の印に使う。透過表示では点より見つけやすい。 */
  cross(cx: number, cy: number, arm: number, level: number): void {
    this.line(cx - arm, cy, cx + arm, cy, level);
    this.line(cx, cy - arm, cx, cy + arm, level);
  }

  rect(x: number, y: number, width: number, height: number, level: number): void {
    this.line(x, y, x + width - 1, y, level);
    this.line(x + width - 1, y, x + width - 1, y + height - 1, level);
    this.line(x + width - 1, y + height - 1, x, y + height - 1, level);
    this.line(x, y + height - 1, x, y, level);
  }

  /** 1 画素 1 バイト。0〜15 を 0〜255 に伸ばす。 */
  toGray8(): Uint8Array {
    const out = new Uint8Array(this.width * this.height);
    for (let i = 0; i < out.length; i += 1) {
      // 15 段を 255 に線形で伸ばす（15*17 = 255）。
      out[i] = (this.pixels[i] ?? 0) * 17;
    }
    return out;
  }

  /**
   * 2 画素 1 バイト。左の画素を上位ニブルに入れる。
   *
   * 上位・下位のどちらが先かは仕様が公開されていない。逆だった場合は
   * 画像が横に 1 画素ずつ入れ替わった縞に見えるので、実機で見れば分かる。
   * 幅が奇数のときは行末を 0 で埋める（行が byte 境界をまたぐと、
   * 1 行ごとにずれて斜めに流れる）。
   */
  toGray4Packed(): Uint8Array {
    const bytesPerRow = Math.ceil(this.width / 2);
    const out = new Uint8Array(bytesPerRow * this.height);

    for (let y = 0; y < this.height; y += 1) {
      for (let x = 0; x < this.width; x += 2) {
        const high = this.pixels[y * this.width + x] ?? 0;
        const low = x + 1 < this.width ? (this.pixels[y * this.width + x + 1] ?? 0) : 0;
        out[y * bytesPerRow + (x >> 1)] = ((high & 0x0f) << 4) | (low & 0x0f);
      }
    }
    return out;
  }

  /** SDK は number[] を推奨している（宿主 Dart の List<int> が受けやすい）。 */
  toNumberArray(packed: boolean): number[] {
    return Array.from(packed ? this.toGray4Packed() : this.toGray8());
  }
}
