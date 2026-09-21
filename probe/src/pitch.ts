/**
 * IMU から頭の上下角（ピッチ）を出す。
 *
 * 実機計測で分かったこと（2026-09-21）:
 * - 静止時の |v| が 0.97 だったので、値の単位は G（重力加速度）。
 *   FAQ の「A units table is still TBD」に対する実測の答え。
 * - 頭を上下に振ったときの振れ幅は x=1.6 / y=0.5 / z=0.7。
 *   単一軸が重力だけで動ける最大は 2.0（-1G〜+1G）なので、その 80% が x に出ている。
 *   **x 軸が頭の前後傾きに対応する。**
 *
 * よって pitch = asin(x)。符号の向き（見上げが + か -）は実機で確かめる。
 */

/** 重力ベクトルから頭の上下角を度で返す。水平が 0。 */
export function pitchDegrees(x: number): number {
  const clamped = Math.max(-1, Math.min(1, x));
  return (Math.asin(clamped) * 180) / Math.PI;
}

/**
 * 見上げ判定。
 *
 * 閾値ちょうどで頭が揺れると状態がばたつくので、ヒステリシスを入れる
 * （バッテリー残量表示と同じ理屈で、これが無いと実用にならない）。
 */
export interface PeekDetectorOptions {
  /** ここを超えたら「見上げた」。度。 */
  enterDegrees?: number;
  /** ここを下回ったら「下げた」。enter より小さくすること。度。 */
  exitDegrees?: number;
}

export class PeekDetector {
  private readonly enter: number;
  private readonly exit: number;
  private up = false;

  constructor(options: PeekDetectorOptions = {}) {
    this.enter = options.enterDegrees ?? 20;
    this.exit = options.exitDegrees ?? 12;
  }

  /** 戻り値は状態が変わったかどうか。 */
  update(pitch: number): boolean {
    const magnitude = Math.abs(pitch);
    if (!this.up && magnitude >= this.enter) {
      this.up = true;
      return true;
    }
    if (this.up && magnitude < this.exit) {
      this.up = false;
      return true;
    }
    return false;
  }

  get isUp(): boolean {
    return this.up;
  }

  get thresholds(): { enter: number; exit: number } {
    return { enter: this.enter, exit: this.exit };
  }
}
