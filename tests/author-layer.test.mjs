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
  fs.cpSync(path.join(path.dirname(source), 'adapters'), path.join(root, 'tools/adapters'), { recursive: true });
  write('author-layer.config.json', config);
  write('tavern-cards-state.json', {
    projectName: '项目名称', description: '项目描述', personality: 'state 性格', scenario: 'state 场景', mes_example: 'state 对话', first_messages: ['opening.md'],
    entryManifest: { lore: { story: { path: 'world/story.md' } } },
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
  const entryName = (sourcePath = 'world/story.md') => {
    const lines = ok('list', sourcePath).stdout.split(/\r?\n/);
    const authorPath = lines.find((line) => line.startsWith('  作者路径：'))?.slice('  作者路径：'.length);
    assert.ok(authorPath, 'list must expose the destination for manual migration');
    return authorPath.slice('作者层/条目/'.length);
  };
  const claim = (keyword) => {
    const result = ok('claim', keyword);
    const opened = result.stdout.split(/\r?\n/).find((line) => line.startsWith('打开：'))?.slice(3);
    assert.ok(opened, result.stdout);
    return path.relative(root, opened).split(path.sep).join('/');
  };
  return { root, write, run, ok, claim, entryName, read: (file) => fs.readFileSync(path.join(root, file), 'utf8') };
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
    { lines: [...conflict(['M'], ['T']), 'a'], conflicts: 1 });
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
  const worldbook = { entries: { one: { comment: 'story', content: 'AI' } } };
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
  const snapshot = p.read(`作者层/快照/条目/${p.entryName()}`);
  p.write('作者层/条目/.editor-cache', '临时文件');
  fs.mkdirSync(path.join(p.root, '作者层/条目/subdir'));
  p.ok('pause');
  assert.equal(p.ok('count').stdout.trim(), '0');
  assert.equal(p.read(`作者层/停用/条目/${p.entryName()}`), '条目正文');
  assert.equal(p.read('作者层/停用/卡面/name.json'), '项目名称');
  assert.equal(p.read('作者层/条目/.editor-cache'), '临时文件');
  assert.match(p.ok('status').stdout, /停用中：4 项/);
  p.ok('resume');
  assert.equal(p.ok('count').stdout.trim(), '4');
  assert.equal(p.read(`作者层/快照/条目/${p.entryName()}`), snapshot);
  p.ok('toggle');
  p.ok('release', 'story.md');
  assert.equal(p.read(`作者层/已取消/条目/${p.entryName()}`), '条目正文');
  p.ok('toggle');
  assert.equal(p.ok('count').stdout.trim(), '3');
});

test('pause and resume validate unknown files and all destinations before moving', (t) => {
  const p = project(t);
  p.ok('claim', 'story.md');
  p.ok('claim', 'name.json');
  p.write('作者层/条目/unknown.json', '未知文件');
  assert.match(p.run('pause').stderr, /unknown.json.*无法唯一迁移/);
  assert.equal(p.read(`作者层/条目/${p.entryName()}`), '条目正文');
  fs.unlinkSync(path.join(p.root, '作者层/条目/unknown.json'));
  p.write('作者层/停用/卡面/name.json', '已有内容');
  assert.match(p.run('pause').stderr, /目标已存在同名文件/);
  assert.equal(p.read(`作者层/条目/${p.entryName()}`), '条目正文');
  assert.equal(p.read('作者层/停用/卡面/name.json'), '已有内容');
  fs.unlinkSync(path.join(p.root, '作者层/停用/卡面/name.json'));
  p.ok('pause');
  p.write('作者层/停用/条目/unknown.md', '未知文件');
  assert.match(p.run('resume').stderr, /unknown.md.*无法唯一迁移/);
  assert.equal(p.read(`作者层/停用/条目/${p.entryName()}`), '条目正文');
  fs.unlinkSync(path.join(p.root, '作者层/停用/条目/unknown.md'));
  p.write('作者层/卡面/name.json', '已有内容');
  assert.match(p.run('resume').stderr, /目标已存在同名文件/);
  assert.equal(p.read(`作者层/停用/条目/${p.entryName()}`), '条目正文');
});

test('template configuration and JSON errors are explicit and leave claims untouched', (t) => {
  const p = project(t, { adapter: 'template-compat', cardFields: [{ key: 'personality', file: 'personality.md' }] });
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

test('default adapter reads all text fields from state and ignores template configuration', (t) => {
  const p = project(t, {});
  p.write('card-build.config.json', '{');
  const expectations = {
    '名称.txt': '项目名称', '描述.txt': '项目描述', '性格.txt': 'state 性格',
    '场景.txt': 'state 场景', '对话示例.txt': 'state 对话',
  };
  for (const [name, value] of Object.entries(expectations)) {
    const file = p.claim(name);
    assert.equal(p.read(file), value);
  }
  const state = JSON.parse(p.read('tavern-cards-state.json'));
  state.personality = 'new 性格';
  state.scenario = 'new 场景';
  state.mes_example = 'new 对话';
  p.write('tavern-cards-state.json', state);
  p.ok('sync');
  assert.equal(p.read('作者层/卡面/性格.txt'), 'new 性格');
  assert.equal(p.read('作者层/卡面/场景.txt'), 'new 场景');
  assert.equal(p.read('作者层/卡面/对话示例.txt'), 'new 对话');
});

test('uid-free manifest entries with the same basename claim, sync and apply independently', async (t) => {
  const p = project(t, { cardFields: [] });
  p.write('tavern-cards-state.json', {
    entryManifest: {
      角色: { 苏云: { path: 'characters/basic.yaml' } },
      NPC: { 店员: { path: 'npcs/basic.yaml' } },
    },
  });
  p.write('characters/basic.yaml', '苏云正文');
  p.write('npcs/basic.yaml', '店员正文');
  assert.match(p.ok('claim', 'basic.yaml').stdout, /匹配到 2 项/);
  const first = p.claim('characters/basic.yaml');
  const second = p.claim('npcs/basic.yaml');
  assert.notEqual(first.toLowerCase(), second.toLowerCase());
  assert.ok(first.endsWith('.yaml') && second.endsWith('.yaml'));
  assert.equal(p.read(first), '苏云正文');
  assert.equal(p.read(second), '店员正文');
  p.write('characters/basic.yaml', '苏云新版');
  p.write('npcs/basic.yaml', '店员新版');
  p.ok('sync');
  assert.equal(p.read(first), '苏云新版');
  assert.equal(p.read(second), '店员新版');
  // 源路径改变不改变类型+条目名的身份。
  const state = JSON.parse(p.read('tavern-cards-state.json'));
  state.entryManifest.角色.苏云.path = 'moved/basic.yaml';
  p.write('tavern-cards-state.json', state);
  p.write('moved/basic.yaml', '苏云第三版');
  p.ok('sync');
  assert.equal(p.read(first), '苏云第三版');
  const api = await import(pathToFileURL(path.join(p.root, 'tools/author-layer.mjs')));
  const book = { entries: { arbitrary: { comment: '店员', content: '' }, another: { comment: '苏云', content: '' } } };
  assert.equal(api.applyAuthorLayer(book), 2);
  assert.equal(book.entries.arbitrary.content, '店员新版');
  assert.equal(book.entries.another.content, '苏云第三版');
  p.ok('pause');
  assert.equal(p.ok('count').stdout.trim(), '0');
  p.ok('resume');
  assert.equal(p.read(first), '苏云第三版');
  assert.equal(p.read(second), '店员新版');
});

test('duplicate output comments require explicit manifest identities and validate before applying', async (t) => {
  const p = project(t, { cardFields: [] });
  p.write('tavern-cards-state.json', { entryManifest: {
    A: { basic: { path: 'a/basic.md' } }, B: { basic: { path: 'b/basic.md' } },
  } });
  p.write('a/basic.md', 'A'); p.write('b/basic.md', 'B');
  p.claim('a/basic.md'); p.claim('b/basic.md');
  const api = await import(pathToFileURL(path.join(p.root, 'tools/author-layer.mjs')));
  const book = { entries: { x: { comment: 'basic', content: 'x' }, y: { comment: 'basic', content: 'y' } } };
  const before = structuredClone(book);
  assert.throws(() => api.applyAuthorLayer(book), /entryIdentities/);
  assert.deepEqual(book, before);
  assert.throws(() => api.applyAuthorLayer(book, { entryIdentities: { x: ['A', 'basic'], y: ['unknown', 'basic'] } }), /身份不在/);
  assert.deepEqual(book, before);
  assert.equal(api.applyAuthorLayer(book, { entryIdentities: { x: ['B', 'basic'], y: ['A', 'basic'] } }), 2);
  assert.equal(book.entries.x.content, 'B'); assert.equal(book.entries.y.content, 'A');
  const missing = { entries: {} };
  assert.throws(() => api.applyAuthorLayer(missing), /无法唯一对应/);
});

test('contents fragments are joined like forge and fragment-only leaves are excluded', async (t) => {
  const p = project(t, { cardFields: [] });
  p.write('tavern-cards-state.json', { entryManifest: {
    角色: {
      组合: { contents: [{ content: '<角色>' }, { file: 'world/basic.md' }, { content: '</角色>' }] },
      片段: { path: 'world/basic.yaml' },
    },
  } });
  p.write('world/basic.md', '正文');
  assert.doesNotMatch(p.ok('list').stdout, /角色 · 片段/);
  const file = p.claim('角色 · 组合');
  assert.equal(p.read(file), '<角色>\n正文\n</角色>');
  p.write('world/basic.md', '新版');
  p.ok('sync');
  assert.equal(p.read(file), '<角色>\n新版\n</角色>');
  const api = await import(pathToFileURL(path.join(p.root, 'tools/author-layer.mjs')));
  const book = { entries: [{ comment: '组合', content: '' }] };
  assert.equal(api.applyAuthorLayer(book), 1);
  assert.equal(book.entries[0].content, p.read(file));
});

test('multiple inline/file openings sync by state index and override both greeting fields', async (t) => {
  const p = project(t, {});
  const state = JSON.parse(p.read('tavern-cards-state.json'));
  state.first_messages = ['opening.md', 'alternate.json', '内联\n第三段'];
  p.write('tavern-cards-state.json', state);
  p.write('alternate.json', '第二段');
  const primary = p.claim('first_messages[0]');
  const alternate = p.claim('first_messages[1]');
  const third = p.claim('first_messages[2]');
  assert.equal(primary, '作者层/卡面/开场白.txt');
  assert.equal(alternate, '作者层/卡面/开场白/1.txt');
  assert.equal(p.read(third), '内联\n第三段');
  p.write('alternate.json', '第二段新版');
  state.first_messages[2] = '内联\n第三段新版';
  p.write('tavern-cards-state.json', state);
  p.ok('sync');
  assert.equal(p.read(alternate), '第二段新版');
  assert.equal(p.read(third), '内联\n第三段新版');
  p.write(primary, '作者第一段'); p.write(alternate, '作者第二段');
  const api = await import(pathToFileURL(path.join(p.root, 'tools/author-layer.mjs')));
  const card = { first_mes: 'AI', data: { first_mes: 'AI', alternate_greetings: ['AI2', 'AI3', '保留其他项'] } };
  assert.equal(api.applyAuthorCardFields(card), 3);
  assert.equal(card.first_mes, '作者第一段');
  assert.equal(card.data.first_mes, '作者第一段');
  assert.deepEqual(card.data.alternate_greetings, ['作者第二段', '内联\n第三段新版', '保留其他项']);
  p.ok('pause');
  const untouched = structuredClone(card);
  assert.equal(api.applyAuthorCardFields(card), 0);
  assert.deepEqual(card, untouched);
  p.ok('resume');
  p.ok('release', 'first_messages[1]');
  assert.equal(p.ok('count').stdout.trim(), '2');
  state.first_messages = ['opening.md'];
  p.write('tavern-cards-state.json', state);
  assert.match(p.run('sync').stderr, /开场白.*2.txt.*找不到对应身份/);
  assert.equal(p.read(third), '内联\n第三段新版');
});

test('same-position insertions conflict at the start, middle, end and empty baseline', async (t) => {
  const p = project(t);
  const { mergeThree } = await import(pathToFileURL(path.join(p.root, 'tools/author-layer.mjs')));
  for (const base of [[], ['head', 'tail']]) {
    for (let index = 0; index <= base.length; index += 1) {
      const mine = [...base.slice(0, index), 'M', ...base.slice(index)];
      const theirs = [...base.slice(0, index), 'T', ...base.slice(index)];
      assert.deepEqual(mergeThree(base, mine, theirs), {
        lines: [...base.slice(0, index), ...conflict(['M'], ['T']), ...base.slice(index)], conflicts: 1,
      });
    }
  }
  assert.deepEqual(mergeThree(['a'], ['same', 'a'], ['same', 'a']),
    { lines: [...conflict(['same'], ['same']), 'a'], conflicts: 1 });
  const file = p.claim('world/story.md');
  p.write(file, '作者插入\n条目正文'); p.write('world/story.md', 'AI插入\n条目正文');
  assert.match(p.ok('sync').stdout, /1 处双方/);
  assert.equal(p.read(file), [...conflict(['作者插入'], ['AI插入']), '条目正文'].join('\n'));
});

test('legacy active/paused text and snapshots migrate together and preserve three-way history', (t) => {
  const p = project(t);
  const name = p.entryName();
  p.write('作者层/条目/story.md', '作者头\na\nb');
  p.write('作者层/快照/story.md', 'head\na\nb');
  p.write('world/story.md', 'head\na\nAI尾');
  const result = p.ok('count');
  assert.equal(result.stdout.trim(), '1'); assert.match(result.stderr, /已迁移作者层路径/);
  assert.equal(p.read(`作者层/条目/${name}`), '作者头\na\nb');
  assert.equal(p.read(`作者层/快照/条目/${name}`), 'head\na\nb');
  assert.equal(fs.existsSync(path.join(p.root, '作者层/条目/story.md')), false);
  p.ok('sync');
  assert.equal(p.read(`作者层/条目/${name}`), '作者头\na\nAI尾');
  p.ok('pause');
  // 模拟仍使用旧布局的停用目录。
  fs.renameSync(path.join(p.root, `作者层/停用/条目/${name}`), path.join(p.root, '作者层/停用/条目/story.md'));
  fs.renameSync(path.join(p.root, `作者层/快照/条目/${name}`), path.join(p.root, '作者层/快照/story.md'));
  p.ok('resume');
  assert.equal(p.read(`作者层/条目/${name}`), '作者头\na\nAI尾');
  assert.equal(p.read(`作者层/快照/条目/${name}`), 'head\na\nAI尾');
});

test('ambiguous legacy data blocks before moving any text or snapshot, with usable migration paths', (t) => {
  const p = project(t, { cardFields: [] });
  p.write('tavern-cards-state.json', { entryManifest: {
    A: { basic: { path: 'a/basic.md' }, unique: { path: 'a/unique.md' } },
    B: { basic: { path: 'b/basic.md' } },
  } });
  for (const file of ['basic.md', 'unique.md']) {
    p.write(`作者层/条目/${file}`, `作者 ${file}`);
    p.write(`作者层/快照/${file}`, `基线 ${file}`);
  }
  const listing = p.ok('list').stdout;
  assert.match(listing, /旧路径待迁移/); assert.match(listing, /作者路径：作者层\/条目\//);
  const result = p.run('sync');
  assert.equal(result.status, 1); assert.match(result.stderr, /无法唯一迁移.*原文件已保留/);
  for (const file of ['basic.md', 'unique.md']) {
    assert.equal(p.read(`作者层/条目/${file}`), `作者 ${file}`);
    assert.equal(p.read(`作者层/快照/${file}`), `基线 ${file}`);
  }
});

test('legacy migration refuses existing targets and handles orphan snapshots and removed identities', (t) => {
  const p = project(t);
  const name = p.entryName();
  p.write('作者层/条目/story.md', '旧正文');
  p.write(`作者层/条目/${name}`, '现有正文');
  p.write('作者层/快照/story.md', '旧基线');
  assert.match(p.run('count').stderr, /迁移目标已存在/);
  assert.equal(p.read('作者层/条目/story.md'), '旧正文');
  assert.equal(p.read(`作者层/条目/${name}`), '现有正文');
  assert.equal(p.read('作者层/快照/story.md'), '旧基线');
  fs.unlinkSync(path.join(p.root, '作者层/条目/story.md'));
  p.ok('count');
  assert.equal(p.read(`作者层/快照/条目/${name}`), '旧基线');
  p.write('tavern-cards-state.json', { entryManifest: {} });
  assert.match(p.run('count').stderr, /找不到对应身份/);
  assert.equal(p.read(`作者层/条目/${name}`), '现有正文');
});

test('Windows names remain readable and distinct for case, separators, reserved names and percent escapes', (t) => {
  const p = project(t, { cardFields: [] });
  const names = ['CON', 'Name', 'name', 'a/b', 'a%2Fb', '尾部. ', '角色:信息', 'a*b', '.隐藏条目', '~条目', ''];
  const entries = Object.fromEntries(names.map((name, i) => [name, { contents: [{ content: `正文${i}` }] }]));
  p.write('tavern-cards-state.json', { entryManifest: { '类型/特殊': entries } });
  const files = names.map((name) => p.claim(JSON.stringify(['类型/特殊', name])));
  assert.equal(new Set(files.map((file) => file.toLowerCase())).size, names.length);
  files.forEach((file, i) => {
    assert.equal(p.read(file), `正文${i}`);
    assert.doesNotMatch(path.basename(file), /[<>:"\\|?*]/);
  });
  p.ok('pause'); p.ok('resume');
  assert.equal(p.ok('count').stdout.trim(), String(names.length));
});

test('state/config errors are explicit; missing state and custom text fields retain CLI compatibility', (t) => {
  const p = project(t, { cardFields: [{ key: 'system_prompt', file: 'system.md' }] });
  const state = JSON.parse(p.read('tavern-cards-state.json'));
  state.system_prompt = '自定义系统提示';
  p.write('tavern-cards-state.json', state);
  assert.equal(p.read(p.claim('system.md')), '自定义系统提示');
  p.write('tavern-cards-state.json', '{');
  assert.match(p.run('sync').stderr, /tavern-cards-state.json 不是合法 JSON/);
  p.write('author-layer.config.json', { adapter: 'unknown' });
  assert.match(p.run('count').stderr, /未知 adapter/);
  p.write('author-layer.config.json', '{');
  assert.match(p.run('count').stderr, /author-layer.config.json 不是合法 JSON/);
  p.write('author-layer.config.json', {});
  fs.unlinkSync(path.join(p.root, 'tavern-cards-state.json'));
  assert.match(p.ok('list').stdout, /根目录没有/);
});

test('registered dot files migrate and nested configured card paths remain visible through pause/resume', (t) => {
  const p = project(t, { cardFields: [{ key: 'personality', file: '.fields\\personality.md' }] });
  const state = JSON.parse(p.read('tavern-cards-state.json'));
  state.entryManifest.lore.story.path = 'world/.story.md';
  p.write('tavern-cards-state.json', state);
  p.write('world/.story.md', 'AI正文');
  p.write('作者层/条目/.story.md', '作者正文');
  p.write('作者层/快照/.story.md', '旧底稿');
  const name = p.entryName('world/.story.md');
  const cardFile = p.claim('personality.md');
  assert.equal(cardFile, '作者层/卡面/.fields/personality.md');
  assert.equal(p.ok('count').stdout.trim(), '2');
  assert.equal(p.read(`作者层/条目/${name}`), '作者正文');
  assert.equal(p.read(`作者层/快照/条目/${name}`), '旧底稿');
  p.ok('pause'); p.ok('resume');
  assert.equal(p.ok('count').stdout.trim(), '2');
  assert.equal(p.read(cardFile), 'state 性格');
});
