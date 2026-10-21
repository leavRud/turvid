// Выкладка сайта на GitHub Pages: leavrud.github.io (репозиторий leavRud/leavrud.github.io).
// Собирает dist и кладёт его в корень того репозитория; папку chessai/ (шахматы) и README не трогает.
// GitHub Pages не умеет «все адреса → index.html», поэтому рядом — 404.html, копия index.html:
// по /hikes/…, /s/… GitHub отдаёт её, и приложение само разбирает адрес.
//
// Запуск: npm run deploy   (нужен .env с VITE_SUPABASE_URL и VITE_SUPABASE_ANON_KEY)

import { execFileSync, execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

const REPO = 'https://github.com/leavRud/leavrud.github.io.git';
/** Рабочая копия репозитория сайта (в .gitignore). */
const DIR = '.pages';
/** Это в репозитории сайта — не наше, не трогаем. */
const KEEP = new Set(['.git', 'chessai', 'README.md']);

const git = (...args) => execFileSync('git', ['-C', DIR, ...args], { stdio: 'inherit' });
const gitOut = (...args) =>
  execFileSync('git', ['-C', DIR, ...args])
    .toString()
    .trim();

execSync('npm run build', { stdio: 'inherit' });

if (existsSync(DIR)) git('pull', '--ff-only');
else execFileSync('git', ['clone', REPO, DIR], { stdio: 'inherit' });
// Автор коммитов выкладки — тот же, что в этом репозитории (глобально git может быть не настроен).
for (const key of ['user.name', 'user.email']) {
  const value = execFileSync('git', ['config', key]).toString().trim();
  git('config', key, value);
}

// Один раз: шахматы лежали в корне — переложить их в chessai/, ничего не удаляя.
if (!existsSync(join(DIR, 'chessai')) && existsSync(join(DIR, 'app.js'))) {
  mkdirSync(join(DIR, 'chessai'));
  for (const name of readdirSync(DIR)) {
    if (name === '.git' || name === 'chessai' || name === 'README.md') continue;
    git('mv', name, `chessai/${name}`);
  }
}

// Прежняя выкладка Turvid — долой, новая — на её место.
for (const name of readdirSync(DIR)) {
  if (!KEEP.has(name)) rmSync(join(DIR, name), { recursive: true, force: true });
}
cpSync('dist', DIR, { recursive: true });
cpSync('dist/index.html', join(DIR, '404.html'));
// Без Jekyll: GitHub не будет ничего пересобирать и прятать файлы с «_» в начале.
writeFileSync(join(DIR, '.nojekyll'), '');

git('add', '-A');
if (!gitOut('status', '--porcelain')) {
  console.log('Нечего выкладывать — сайт уже такой.');
  process.exit(0);
}
// npm run deploy -- --dry: всё подготовить и показать, но не коммитить и не отправлять.
if (process.argv.includes('--dry')) {
  git('status', '--short');
  process.exit(0);
}
const hash = execFileSync('git', ['rev-parse', '--short', 'HEAD']).toString().trim();
const trailer = process.env.DEPLOY_COMMIT_TRAILER ? `\n\n${process.env.DEPLOY_COMMIT_TRAILER}` : '';
git('commit', '-q', '-m', `Turvid ${hash}${trailer}`);
git('push');
console.log('Выложено: https://leavrud.github.io/ — GitHub обновит сайт за минуту-две.');
