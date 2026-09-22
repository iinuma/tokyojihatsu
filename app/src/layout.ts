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

/** カウントダウン画面のコンテナ。 */
export const COUNTDOWN = {
  /** 左上端の日時。日・曜日・時分秒。 */
  clock: { id: 4, name: 'clock', x: 0, y: 0, width: 260, height: 34 },
  /** 「あと 3:42」。上部の左寄りに置き、スペースで中央付近まで送る。 */
  remaining: { id: 1, name: 'remaining', x: 0, y: 56, width: 340, height: 72 },
  /** 「次発 18:42 / 次々発 18:49」。右上 2 行。 */
  upcoming: { id: 2, name: 'upcoming', x: 340, y: 44, width: 236, height: 80 },
  /** 駅名・路線・方面と、時刻表ベースである旨。 */
  footer: { id: 3, name: 'footer', x: 0, y: 214, width: 576, height: 66 },
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
 * List コンテナの 1 項目に収まるよう切り詰める。
 * firmware の上限は 64 文字。溢れると黙って落ちるので手前で切る。
 */
export function truncateItem(text: string, limit = 60): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}
