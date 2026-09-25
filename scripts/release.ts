/**
 * 提出用ビルド。
 *
 * Even Hub は Add build を押した瞬間にリリースノートを確定させる。あとから
 * 直せない。にもかかわらずノートを書く場所はその 1 フィールドしかないので、
 * **アップロードの前に文面が揃っていること**をここで強制する。
 *
 * 検証用のビルド（app:pack）には何の制約も掛けない。版を上げずに何度でも
 * 焼ける。版は「ビルドの単位」ではなく「アップロードの単位」で、提出すると
 * 決めたときにだけ 1 つ上げる。0.4.0〜0.4.2 が欠番になったのは、検証のたびに
 * 版を上げていたからだった。
 *
 * スクリーンショットも同じ理由でここで見る。**審査中は Store listing を
 * 編集できない**ので、画像が古いまま提出すると、審査が終わるまで直せない。
 * 0.4.3 では About の文言を直したのに画像は 2 版ぶん古いままで、ストアの
 * 画像がアプリの実装と矛盾したまま公開されていた。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const MANIFEST = resolve(ROOT, 'app/app.json');
const NOTES = resolve(ROOT, 'docs/release-notes.md');

/** ノートの推奨行数。ポータルの表示が崩れない範囲。 */
const MAX_NOTE_LINES = 3;

interface Manifest {
  name: string;
  version: string;
  supported_languages: string[];
}

function fail(message: string, hint?: string): never {
  console.error(`\n  ✗ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

function git(...args: string[]): string {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

/**
 * `## 0.4.3` の節から、言語ごとのコードブロックを取り出す。
 *
 * 見出しには「（初版として提出する場合）」のような注記が付くことがあるので、
 * 版に前方一致する見出しを探す。
 */
function readNotes(version: string, languages: string[]): Map<string, string> {
  const markdown = readFileSync(NOTES, 'utf8');
  const lines = markdown.split('\n');

  const start = lines.findIndex((line) => {
    const heading = /^##\s+(.+)$/.exec(line);
    if (!heading) return false;
    return (heading[1] ?? '').trim().startsWith(version);
  });
  if (start < 0) {
    fail(
      `docs/release-notes.md に「## ${version}」がありません。`,
      'アップロード後はノートを直せない。上げる前にここへ書く。',
    );
  }

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s/.test(lines[i] ?? '')) {
      end = i;
      break;
    }
  }
  const section = lines.slice(start, end);

  const found = new Map<string, string>();
  for (let i = 0; i < section.length; i += 1) {
    const heading = /^###\s+([a-z-]+)\s*$/.exec(section[i] ?? '');
    if (!heading) continue;
    const language = heading[1];
    if (!language) continue;

    // その言語の見出しから次の見出しまでを範囲とし、最初のコードブロックを本文とみなす。
    // 範囲を区切らないと、本文を書き忘れた言語が次の言語のブロックを拾ってしまう。
    let limit = section.length;
    for (let j = i + 1; j < section.length; j += 1) {
      if (/^###?\s/.test(section[j] ?? '')) {
        limit = j;
        break;
      }
    }

    const open = section.findIndex((line, index) => index > i && index < limit && /^```/.test(line));
    if (open < 0) continue;
    const close = section.findIndex((line, index) => index > open && index < limit && /^```/.test(line));
    if (close < 0) continue;

    const body = section.slice(open + 1, close).join('\n').trim();
    if (body.length > 0) found.set(language, body);
  }

  const missing = languages.filter((language) => !found.has(language));
  if (missing.length > 0) {
    fail(
      `「## ${version}」に ${missing.join(' / ')} のノートがありません。`,
      `app.json の supported_languages は ${languages.join(', ')}。全部の言語で要る。`,
    );
  }

  return found;
}

/** そのパスに最後に触れたコミットの日時（UNIX 秒）。無ければ 0。 */
function lastCommitAt(path: string): number {
  try {
    const out = git('log', '-1', '--format=%ct', '--', path);
    return out.length > 0 ? Number(out) : 0;
  } catch {
    return 0;
  }
}

/**
 * 画面を変えたのにスクリーンショットを撮り直していないと、古い画像のまま
 * 提出することになる。**審査中は Store listing を編集できない**ので、
 * 気づいても審査が終わるまで直せない。
 *
 * app/src のほうが assets/screenshots より新しければ止める。文言に関係ない
 * 変更でも引っかかるが、提出は頻繁ではないので、空振りより見逃しを嫌う。
 */
function checkScreenshots(): void {
  const code = lastCommitAt('app/src');
  const shots = lastCommitAt('assets/screenshots');

  if (code === 0 || shots === 0) return;
  if (shots >= code) {
    console.log('  ✓ スクリーンショットはコードより新しい');
    return;
  }

  const days = Math.round((code - shots) / 86400);
  fail(
    `スクリーンショットがコードより古いままです（${days} 日ぶん）。`,
    '審査中は Store listing を編集できない。撮り方は assets/screenshots/README.md。\n' +
      '    画面に影響しない変更なら SKIP_SCREENSHOT_CHECK=1 で通せる。',
  );
}

function main(): void {
  const manifest: Manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const { version, name, supported_languages: languages } = manifest;

  console.log(`\n  ${name} v${version} を提出用にビルドします。\n`);

  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    fail(`app.json の version が "${version}" です。x.y.z の形にしてください。`);
  }

  // 既にタグがある＝その版はアップロード済み。上げ直すと欠番と混乱を生む。
  const tag = `v${version}`;
  const tags = git('tag', '--list', tag);
  if (tags.length > 0) {
    fail(
      `${tag} は既にタグが打たれています。アップロード済みの版です。`,
      'app.json の version を上げて、新しいノートを書いてください。',
    );
  }

  // タグが指す中身を確定させたいので、コミットされていない変更は許さない。
  const dirty = git('status', '--porcelain');
  if (dirty.length > 0) {
    fail(
      '未コミットの変更があります。',
      'どのコミットが提出物かを後から辿れるよう、先にコミットしてください。',
    );
  }

  if (process.env.SKIP_SCREENSHOT_CHECK === '1') {
    console.log('  ! スクリーンショット検査をとばしています');
  } else {
    checkScreenshots();
  }

  const notes = readNotes(version, languages);

  for (const [language, body] of notes) {
    const count = body.split('\n').filter((line) => line.trim().length > 0).length;
    if (count > MAX_NOTE_LINES) {
      console.log(`  ! ${language} のノートが ${count} 行あります（推奨 ${MAX_NOTE_LINES} 行以下）`);
    }
  }

  console.log('  ✓ リリースノート（' + [...notes.keys()].join(' / ') + '）');
  console.log('  ✓ タグ未使用、作業ツリーはクリーン\n');

  execFileSync('npm', ['run', 'app:pack'], { cwd: ROOT, stdio: 'inherit' });

  console.log(`\n${'─'.repeat(64)}`);
  console.log(`  Add build に貼るもの（v${version}）`);
  console.log('─'.repeat(64));
  for (const language of languages) {
    console.log(`\n[${language}]\n`);
    console.log(notes.get(language));
  }
  console.log(`\n${'─'.repeat(64)}`);
  console.log('  アップロードが通ったら、この版を固定する:');
  console.log(`\n    git tag ${tag} && git push origin ${tag}\n`);
  console.log('─'.repeat(64) + '\n');
}

main();
