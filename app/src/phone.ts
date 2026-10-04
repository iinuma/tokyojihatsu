/**
 * スマートフォン側の画面。
 *
 * プラグインは Even アプリの中の WebView で動くので、**手元の画面にも中身がある**。
 * 以前はグラスと同じ文字列を `<pre>` に流しているだけで、何のアプリで何ができるのかが
 * 分からなかった。審査の指摘（2026-10-03）はそこを突いている。
 *
 *   「スマートフォン側の画面にはメガネと同じ内容のみが表示され、操作説明や設定などがなく、
 *     用途や使い方が分かりにくい状態です」
 *
 * 静的な説明（使い方・操作・データについて）は index.html に置き、
 * ここは**状態の反映と、押したときの振る舞い**だけを持つ。
 *
 * 審査員が日本語を読むとは限らないので、画面は日英併記にしてある。
 */

export interface PhoneState {
  /** グラス側のホストに繋がっているか。素のブラウザでは false。 */
  connected: boolean;
  /** 「大門」「大門 ・ 浅草線・西馬込方面」など。未選択なら null。 */
  selectionLabel: string | null;
  /** 「次発 08:50 ／ 次々発 08:55」のような 1 行。無ければ空。 */
  departureLine: string;
  /** いま何をしている状態か（未選択・取得中など）の 1 行。 */
  statusLine: string;
  peekEnabled: boolean;
  sourceDate: string;
  contactEmail: string;
}

export interface PhoneHandlers {
  togglePeek(): void | Promise<void>;
  reselectStation(): void | Promise<void>;
}

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** 押したときの振る舞いを繋ぐ。DOM が無い環境（テスト）では何もしない。 */
export function mountPhoneUi(handlers: PhoneHandlers): void {
  byId('p-peek')?.addEventListener('click', () => {
    void handlers.togglePeek();
  });
  byId('p-reselect')?.addEventListener('click', () => {
    void handlers.reselectStation();
  });
}

/** 画面に状態を書き戻す。毎秒呼ばれても困らない程度の処理しかしない。 */
export function updatePhoneUi(state: PhoneState): void {
  const status = byId('p-status');
  if (status) status.textContent = state.selectionLabel ?? state.statusLine;

  const depart = byId('p-depart');
  if (depart) depart.textContent = state.selectionLabel ? state.departureLine : '';

  const conn = byId('p-conn');
  if (conn) {
    conn.textContent = state.connected ? 'グラスに接続中 / Connected' : 'グラス未接続 / Not connected';
    conn.classList.toggle('on', state.connected);
  }

  const peekHint = byId('p-peek-hint');
  const peek = byId('p-peek');
  if (peek && peekHint) {
    // 見出しの先頭に現在の状態を出す。トグルの状態が分からないのが一番困る。
    peek.childNodes[0]!.textContent = `見上げ表示: ${state.peekEnabled ? 'オン / On' : 'オフ（常時表示） / Off'}　`;
  }

  const source = byId('p-source');
  if (source) source.textContent = formatSourceDate(state.sourceDate);

  const mail = byId('p-mail');
  if (mail instanceof HTMLAnchorElement) {
    mail.href = `mailto:${state.contactEmail}`;
    mail.textContent = state.contactEmail;
  }
}

/** グラスに出ている内容をそのまま写す枠。 */
export function updateGlassesMirror(text: string): void {
  const screen = byId('screen');
  if (screen) screen.textContent = text;
}

export function setFooter(text: string): void {
  const foot = byId('p-foot');
  if (foot) foot.textContent = text;
}

/** `2026-09-24T08:00:00+09:00` → `2026-09-24 08:00`。読みやすさのため秒と TZ を落とす。 */
export function formatSourceDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  return match ? `${match[1]} ${match[2]}` : iso || '—';
}
