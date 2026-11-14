// 1つのHTMLファイルにまとめる。実行: node build.mjs
// dist/index.html … そのままブラウザで開ける完全なページ
// dist/artifact.html … claude.ai のアーティファクト用（<html>などの外枠なし）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const css = read('./src/style.css');
const body = read('./src/body.html');
const js = read('./src/sim.js') + '\n' + read('./src/app.js');
const head = `<title>名もなき土地</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap">
<style>
${css}
</style>`;
const content = `${head}\n${body}\n<script>\n${js}\n</script>\n`;
mkdirSync(new URL('./dist/', import.meta.url), { recursive: true });
writeFileSync(new URL('./dist/artifact.html', import.meta.url), content);
writeFileSync(new URL('./dist/index.html', import.meta.url), `<!doctype html>\n<html lang="ja">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n<script>\n${js}\n</script>\n</body>\n</html>\n`);
console.log('built dist/index.html and dist/artifact.html');
