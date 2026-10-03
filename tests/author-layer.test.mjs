import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const source = path.resolve(import.meta.dirname, '../tools/author-layer.mjs');
const stateFields = ['name', 'description', 'first_mes'].map((key) => ({ key, file: `${key}.json` }));

function project(t, config = { cardFields: stateFields }) {
  const root = fs.mkdtempSync(path.join(import.meta.dirname, '.author-layer-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (file, value) => {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
  };
  write('tools/author-layer.mjs', fs.readFileSync(source, 'utf8'));
  write('author-layer.config.json', config);
  write('tavern-cards-state.json', {
    projectName: '项目名称', description: '项目描述', first_messages: ['opening.md'],
    entryManifest: { lore: { story: { path: 'world/story.md', uid: 1 } } },
  });
  write('opening.md', '开场正文');
  write('world/story.md', '条目正文');
  const run = (...args) => spawnSync(process.execPath, [path.join(root, 'tools/author-layer.mjs'), ...args],
    { cwd: root, encoding: 'utf8' });
  const ok = (...args) => {
    const result = run(...args);
    assert.equal(result.status, 0, result.stderr);
    return result;
  };
  return { root, write, run, ok, read: (file) => fs.readFileSync(path.join(root, file), 'utf8') };
}

const conflict = (mine, theirs) => ['<<<<<<< 我的写法', ...mine, '=======', ...theirs, '>>>>>>> AI新改'];

test('mergeThree groups large, nested and transitive overlaps and preserves both sides', async (t) => {
  const p = project(t);
  const { mergeThree } = await import(pathToFileURL(path.join(p.root, 'tools/author-layer.mjs')));
  const base = ['head', 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'tail'];
  const big = ['head', 'M', 'g', 'tail'];
  const small = ['head', 'a', 'T1', 'c', 'd', 'T2', 'f', 'g', 'tail'];
  assert.deepEqual(mergeThree(base, big, small), {
    lines: ['head', ...conflict(['M'], ['a', 'T1', 'c', 'd', 'T2', 'f']), 'g', 'tail'], conflicts: 1,
  });
  assert.deepEqual(mergeThree(base, small, big), {
    lines: ['head', ...conflict(['a', 'T1', 'c', 'd', 'T2', 'f'], ['M']), 'g', 'tail'], conflicts: 1,
  });
  const mine = ['head', 'M1', 'c', 'M2', 'g', 'tail'];
  const theirs = ['head', 'a', 'T1', 'e', 'T2', 'tail'];
  assert.deepEqual(mergeThree(base, mine, theirs), {
    lines: ['head', ...conflict(['M1', 'c', 'M2', 'g'], ['a', 'T1', 'e', 'T2']), 'tail'], conflicts: 1,
  });
  assert.deepEqual(mergeThree(['a', 'b', 'c'], ['M', 'b', 'c'], ['a', 'b', 'T']),
    { lines: ['M', 'b', 'T'], conflicts: 0 });
  assert.deepEqual(mergeThree(['a'], ['M', 'a'], ['T', 'a']),
    { lines: ['M', 'T', 'a'], conflicts: 0 });
  assert.deepEqual(mergeThree(['a', 'b'], [], ['a', 'T']),
    { lines: conflict([], ['a', 'T']), conflicts: 1 });
  assert.deepEqual(mergeThree(['a', 'b', 'c'], ['M', 'c'], ['a', 'T', 'b', 'c']),
    { lines: [...conflict(['M'], ['a', 'T', 'b']), 'c'], conflicts: 1 });
});

test('runtime manages the configured Git ignore block and keeps CLI stdout compatible', (t) => {
  const p = project(t);
  p.write('.gitignore', '# existing\r\n/dist/\r\n');
  assert.equal(p.ok('count').stdout.trim(), '0');
  const initial = p.read('.gitignore');
  assert.ok(initial.startsWith('# existing\r\n/dist/\r\n'));
  assert.ok(initial.includes('/作者层/\r\n'));
  assert.equal(p.ok('layer').stdout.trim(), path.join(p.root, '作者层'));
  assert.equal(p.read('.gitignore'), initial);
  p.write('author-layer.config.json', { layerDir: 'private\\draft [1]', cardFields: stateFields });
  assert.match(p.ok('install-rule').stdout, /Git 忽略保护/);
  const updated = p.read('.gitignore');
  assert.ok(updated.includes('/private/draft\\ \\[1\\]/\r\n'));
  assert.equal(updated.split('# author-layer private content (managed)').length, 2);
  assert.ok(updated.startsWith('# existing\r\n/dist/\r\n'));
  const git = (...args) => spawnSync('git', args, { cwd: p.root, encoding: 'utf8' });
  assert.equal(git('init', '--quiet').status, 0);
  assert.equal(git('check-ignore', 'private/draft [1]/条目/story.md').status, 0);
  p.write('.gitignore', `${updated}!private/**\r\n`);
  p.ok('layer');
  assert.equal(git('check-ignore', 'private/draft [1]/条目/story.md').status, 0);
  const reordered = p.read('.gitignore');
  p.ok('layer');
  assert.equal(p.read('.gitignore'), reordered);
});

test('packaging imports ensure Git ignore protection and apply claimed content', async (t) => {
  const p = project(t);
  p.write('作者层/条目/story.md', '作者正文');
  p.write('作者层/卡面/name.json', '作者名称');
  const api = await import(pathToFileURL(path.join(p.root, 'tools/author-layer.mjs')));
  const worldbook = { entries: { one: { uid: 1, content: 'AI' } } };
  assert.equal(api.applyAuthorLayer(worldbook), 1);
  assert.equal(worldbook.entries.one.content, '作者正文');
  const card = { data: { name: 'AI' }, name: 'AI' };
  assert.equal(api.applyAuthorCardFields(card), 1);
  assert.equal(card.data.name, '作者名称');
  assert.equal(card.name, '作者名称');
  assert.ok(p.read('.gitignore').includes('/作者层/'));
});

test('claim, pause, resume, toggle and release support Markdown and JSON without a template', (t) => {
  const p = project(t);
  for (const keyword of ['story.md', 'name.json', 'description.json', 'first_mes.json']) p.ok('claim', keyword);
  assert.equal(p.read('作者层/卡面/first_mes.json'), '开场正文');
  assert.equal(p.ok('count').stdout.trim(), '4');
  const snapshot = p.read('作者层/快照/story.md');
  p.write('作者层/条目/.editor-cache', '临时文件');
  fs.mkdirSync(path.join(p.root, '作者层/条目/subdir'));
  p.ok('pause');
  assert.equal(p.ok('count').stdout.trim(), '0');
  assert.equal(p.read('作者层/停用/条目/story.md'), '条目正文');
  assert.equal(p.read('作者层/停用/卡面/name.json'), '项目名称');
  assert.equal(p.read('作者层/条目/.editor-cache'), '临时文件');
  assert.match(p.ok('status').stdout, /停用中：4 项/);
  p.ok('resume');
  assert.equal(p.ok('count').stdout.trim(), '4');
  assert.equal(p.read('作者层/快照/story.md'), snapshot);
  p.ok('toggle');
  p.ok('release', 'story.md');
  assert.equal(p.read('作者层/已取消/story.md'), '条目正文');
  p.ok('toggle');
  assert.equal(p.ok('count').stdout.trim(), '3');
});

test('pause and resume validate unknown files and all destinations before moving', (t) => {
  const p = project(t);
  p.ok('claim', 'story.md');
  p.ok('claim', 'name.json');
  p.write('作者层/条目/unknown.json', '未知文件');
  assert.match(p.run('pause').stderr, /unknown.json.*找不到同名条目/);
  assert.equal(p.read('作者层/条目/story.md'), '条目正文');
  fs.unlinkSync(path.join(p.root, '作者层/条目/unknown.json'));
  p.write('作者层/停用/卡面/name.json', '已有内容');
  assert.match(p.run('pause').stderr, /目标已存在同名文件/);
  assert.equal(p.read('作者层/条目/story.md'), '条目正文');
  assert.equal(p.read('作者层/停用/卡面/name.json'), '已有内容');
  fs.unlinkSync(path.join(p.root, '作者层/停用/卡面/name.json'));
  p.ok('pause');
  p.write('作者层/停用/条目/unknown.md', '未知文件');
  assert.match(p.run('resume').stderr, /unknown.md.*找不到同名条目/);
  assert.equal(p.read('作者层/停用/条目/story.md'), '条目正文');
  fs.unlinkSync(path.join(p.root, '作者层/停用/条目/unknown.md'));
  p.write('作者层/卡面/name.json', '已有内容');
  assert.match(p.run('resume').stderr, /目标已存在同名文件/);
  assert.equal(p.read('作者层/停用/条目/story.md'), '条目正文');
});

test('template configuration and JSON errors are explicit and leave claims untouched', (t) => {
  const p = project(t, { cardFields: [{ key: 'personality', file: 'personality.md' }] });
  const fails = (pattern) => {
    const result = p.run('claim', 'personality.md');
    assert.equal(result.status, 1);
    assert.match(result.stderr, pattern);
    assert.equal(fs.existsSync(path.join(p.root, '作者层/卡面/personality.md')), false);
  };
  fails(/找不到文件：.*card-build.config.json/);
  p.write('card-build.config.json', '{');
  fails(/card-build.config.json 不是合法 JSON/);
  for (const config of [{}, { inputs: {} }, { inputs: { cardTemplate: '' } }, { inputs: { cardTemplate: 12 } }]) {
    p.write('card-build.config.json', config);
    fails(/card-build.config.json 缺少有效的 inputs.cardTemplate/);
  }
  p.write('card-build.config.json', { inputs: { cardTemplate: 'templates/card.json' } });
  fails(/找不到文件：.*templates.*card.json/);
  p.write('templates/card.json', '{');
  fails(/card.json 不是合法 JSON/);
  for (const card of [{}, { data: null }, { data: [] }, { data: 'bad' }]) {
    p.write('templates/card.json', card);
    fails(/card.json 缺少有效的 data 对象/);
  }
  p.write('templates/card.json', { data: { personality: '性格正文' } });
  p.ok('claim', 'personality.md');
  assert.equal(p.read('作者层/卡面/personality.md'), '性格正文');
});
