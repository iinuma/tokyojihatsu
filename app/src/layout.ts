/**
 * G2 の画面レイアウト。576x288、絶対座標、コンテナは最大 8 個。
 *
 * 文字サイズは変えられない（firmware 固定フォント、等幅でもない）ので、
 * 効かせられるのは配置・余白・明るさ（textColor 0〜4）だけ。
 * 中央寄せはスペースで埋めるしかなく、等幅でないぶん正確には揃わない。
 */

export const SCREEN_WIDTH = 576;
export const SCREEN_HEIGHT = 288;

/** テキストの明るさ。0 が最も暗く、4 が既定で最も明るい。 */
export const BRIGHT = 4;
export const DIM = 2;

/**
 * カウントダウン画面のコンテナ。
 *
 * 上段に日時と「どの駅のどの方面か」を並べる。駅と方面は利用者が自分で選んだ
 * 情報で、確認の頻度は低い。下に大きく置くと、見上げたとき真っ先に目へ入って
 * しまうので、上段へ移して明るさも落としている（文字サイズは変えられない）。
 */
export const COUNTDOWN = {
  /** 左上端の日時。日・曜日・時分秒。 */
  clock: { id: 4, name: 'clock', x: 0, y: 0, width: 212, height: 38 },
  /** 日時の右。駅・路線・方面。 */
  header: { id: 5, name: 'header', x: 212, y: 0, width: 364, height: 38 },
  /** 残り時間。左寄せで大きく取る。 */
  remaining: { id: 1, name: 'remaining', x: 0, y: 92, width: 316, height: 72 },
  /** 次発・次々発の 2 行。 */
  upcoming: { id: 2, name: 'upcoming', x: 320, y: 84, width: 256, height: 84 },
} as const;

/** 一覧画面（駅選択・方面選択）のコンテナ。 */
export const PICKER = {
  header: { id: 1, name: 'header', x: 0, y: 4, width: 576, height: 34 },
  list: { id: 2, name: 'picker', x: 0, y: 40, width: 576, height: 240 },
} as const;

/** 通知・エラー用の 1 枚画面。 */
export const NOTICE = {
  body: { id: 1, name: 'notice', x: 0, y: 40, width: 576, height: 220 },
} as const;

/**
 * 与えた文字列を、その行の中でおおよそ中央に見えるよう左に空白を足す。
 *
 * フォントが等幅ではないので正確には中央にならない。全角は半角の約 2 倍として
 * 数えた概算で、ずれても読みやすさを損なわない範囲に収める用途にだけ使う。
 */
export function padCenter(text: string, columns: number): string {
  const width = visualWidth(text);
  if (width >= columns) return text;
  return ' '.repeat(Math.floor((columns - width) / 2)) + text;
}

/** 半角を 1、全角を 2 として数えた見た目の幅。 */
export function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) {
    width += isFullWidth(char) ? 2 : 1;
  }
  return width;
}

function isFullWidth(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/**
 * 左の文字列を指定の桁まで空白で埋め、続きが同じ位置から始まるようにする。
 *
 * フォントは等幅ではないが、駅名はほぼ全角なので全角＝半角 2 桁として数えれば
 * 実用上は揃う。桁を超える長い駅名（「東京国際クルーズターミナル」など）は
 * 切らずに溢れさせ、最低 1 つの空白だけ入れる。切ると読めなくなるため。
 */
export function padToColumn(left: string, column: number): string {
  const width = visualWidth(left);
  if (width >= column) return `${left} `;
  return left + ' '.repeat(column - width);
}

/**
 * 画面幅 576px をこのフォントで割ったときの、おおよその半角桁数。
 * 実機の probe 画面から読み取った概算（半角 1 文字 ≒ 14px）。
 */
export const APPROX_COLUMNS = 41;

/** 駅名の右に距離を置く位置。画面の中央あたり。 */
export const DISTANCE_COLUMN = 20;

/**
 * 上段の駅・方面に使える見た目の桁数（364px ÷ 半角 14px ≒ 26）。
 *
 * 時計が 15 桁（212px）なので、残りがこれだけ。路線名まで入れると
 * 26 桁を超える駅が半分以上あるため、入らなければ路線名を落とす。
 * 方面ラベルが行先駅名なので、路線はそこから概ね察しがつく。
 */
export const HEADER_COLUMNS = 26;

/**
 * 見た目の幅で切り詰める。
 *
 * 文字数で切ると、全角ばかりの駅名は実際の 2 倍の幅になって溢れる。
 * 切った印として末尾に … を付ける。
 */
export function truncateToWidth(text: string, columns: number): string {
  if (visualWidth(text) <= columns) return text;

  let width = 0;
  let out = '';
  for (const char of text) {
    const charWidth = isFullWidth(char) ? 2 : 1;
    if (width + charWidth > columns - 1) break; // 省略記号のぶんを残す
    out += char;
    width += charWidth;
  }
  return `${out}…`;
}

/**
 * List コンテナの 1 項目に収まるよう切り詰める。
 * firmware の上限は 64 文字。溢れると黙って落ちるので手前で切る。
 */
export function truncateItem(text: string, limit = 60): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}
