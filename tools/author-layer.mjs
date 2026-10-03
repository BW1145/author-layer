// 作者层工具：把「归你的内容」和「AI 维护的内容」分开，封装时自动合并。
// 位置约定：本文件放在 <项目根>/tools/ 下，项目根由本文件所在目录的上一层反推。
// 可调项写进项目根下的 author-layer.config.json，不写就用本文件里的默认值。
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as tavernCards from './adapters/tavern-cards.mjs';
import * as templateCompat from './adapters/template-compat.mjs';

const root = path.resolve(import.meta.dirname, '..');
const configFileName = 'author-layer.config.json';
const adapters = { 'tavern-cards': tavernCards, 'template-compat': templateCompat };

const defaults = {
  layerDir: '作者层',
  adapter: 'tavern-cards',
  ruleFiles: ['AGENTS.md', 'CLAUDE.md'],
};

const normalize = (raw) => raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
const readText = (file) => normalize(fs.readFileSync(file, 'utf8'));
const writeText = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value, 'utf8');
};
function readJson(file) {
  assert.ok(fs.existsSync(file), `找不到文件：${file}`);
  try {
    return JSON.parse(readText(file));
  } catch (error) {
    throw new Error(`${file} 不是合法 JSON：${error.message}`);
  }
}

function readConfig() {
  const file = path.join(root, configFileName);
  const raw = fs.existsSync(file) ? readJson(file) : {};
  const selected = raw.adapter ?? defaults.adapter;
  assert.ok(Object.hasOwn(adapters, selected), `未知 adapter：${selected}。可用：${Object.keys(adapters).join('、')}`);
  const config = { ...defaults, ...adapters[selected].defaults, ...raw };
  config.ruleFiles = (raw.ruleFiles ?? defaults.ruleFiles).map(String);
  config.cardFields = config.cardFields.map((field) => {
    const key = String(field.key);
    return {
      key,
      file: String(field.file ?? `${key}.txt`).replace(/\\/g, '/'),
      label: String(field.label ?? `卡面 · ${key}`),
    };
  });
  if (raw.ruleMarkdown !== undefined) config.ruleMarkdown = normalize(String(raw.ruleMarkdown));
  return config;
}

const config = readConfig();

const layerDir = path.resolve(root, String(config.layerDir).replace(/\\/g, '/'));
const entryDir = path.join(layerDir, '条目');
const cardDir = path.join(layerDir, '卡面');
const snapshotDir = path.join(layerDir, '快照');
const pausedDir = path.join(layerDir, '停用');
const adapter = adapters[config.adapter].createAdapter({ root, config, readText, readJson });

function ensureGitIgnore() {
  const relative = path.relative(root, layerDir).split(path.sep).join('/');
  assert.ok(relative && relative !== '..' && !relative.startsWith('../') && !path.isAbsolute(relative)
    && !/[\r\n]/.test(relative), 'layerDir 必须是项目根下的子目录。');
  const file = path.join(root, '.gitignore');
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const eol = text.includes('\r\n') ? '\r\n' : '\n';
  const start = '# author-layer private content (managed)';
  const end = '# end author-layer private content';
  const pattern = `/${relative.replace(/([\\*?\[\] ])/g, '\\$1')}/`;
  const block = [start, pattern, end].join(eol);
  const lines = text.split(/\r?\n/);
  const startLine = lines.indexOf(start);
  const endLine = lines.indexOf(end);
  assert.ok((startLine === -1 && endLine === -1) || (startLine >= 0 && endLine > startLine),
    '.gitignore 的 author-layer 管理段标记不完整，请修复后重试。');
  // 管理段置于末尾，避免后面的反向规则重新放行私人目录。
  const rest = startLine >= 0
    ? [...lines.slice(0, startLine), ...lines.slice(endLine + 1)].join(eol)
    : text;
  const updated = `${rest}${rest && !rest.endsWith('\n') ? eol : ''}${block}${eol}`;
  if (updated !== text) {
    writeText(file, updated);
    console.error(`提示：已在 .gitignore 中保护 ${config.layerDir}/ 私人内容。`);
  }
}

const isSyncCommand = process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename
  && process.argv[2] === 'sync';
if (!isSyncCommand) ensureGitIgnore();

const ruleStart = '<!-- 作者层规则 开始';
const ruleEnd = '<!-- 作者层规则 结束 -->';

function defaultRuleLines() {
  const dir = config.layerDir;
  return [
    `## 作者层（${dir}/）`,
    '',
    `「${dir}/」是用户本人的私人内容，由用户自己负责，可能涉及未公开设定与隐私。它不在你的工作范围内，视同不存在：不要读、不要列目录、不要搜索、不要比对、不要提及内容，也不要因为读不到就觉得任务做不下去。`,
    '',
    `- 遇到跟作者层有关的事（某条归谁、AI 改过什么、要不要合并、成品里某个字段是谁的版本），默认交回给用户处理，不要自己去作者层找答案，也不要替用户动作者层里的文件。`,
    `- 交付、全卡检查、审计、一致性核对、装机测试、排查差异等任务的工作范围默认都不含作者层。不要为了确认成品、提高把握或找差异去读它。`,
    `- 组装时由 adapter 按清单身份把「${dir}/条目/」正文覆盖到对应条目，用「${dir}/卡面/」覆盖卡面字段。合并由脚本自动完成，你不需要知道里面的内容；成品以用户版本为准是设计，不是异常。`,
    `- 不要把它写进交付说明、更新记录或对话回复。`,
    '- 只能看名字和状态，不能看内容：node tools/author-layer.mjs status。改动某条公开源之前先看它是否已被认领；已认领的内容只有用户明确要求时才动。',
    '- 认领、同步、停用与恢复、取消认领由用户自己用启动器完成，AI 不代跑 claim、sync、toggle、release。',
    '- 封装器不报告作者层的合并情况。',
  ];
}

function buildRuleBlock() {
  const body = config.ruleMarkdown !== undefined
    ? config.ruleMarkdown.replace(/^\n+|\n+$/g, '').split('\n')
    : defaultRuleLines();
  return [
    `${ruleStart}（由 我的改动.cmd 自动写入；可以改文字，别删这两行标记） -->`,
    '',
    ...body,
    '',
    ruleEnd,
  ].join('\n');
}

const ruleBlock = buildRuleBlock();

const conflictStart = '<<<<<<< 我的写法';
const conflictMiddle = '=======';
const conflictEnd = '>>>>>>> AI新改';

function stateNote() {
  const note = adapter.note();
  if (note) console.log(note);
}

const section = (row) => row.kind === 'card' ? '卡面' : '条目';
const pausedFile = (row) => path.join(pausedDir, section(row), row.name);

function layerFiles(dir, prefix = '', knownNames = new Set()) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = prefix ? prefix + '/' + entry.name : entry.name;
    if ((entry.name.startsWith('.') || entry.name.startsWith('~'))
      && ![...knownNames].some((known) => known === name || known.startsWith(name + '/'))) continue;
    if (entry.isDirectory()) files.push(...layerFiles(path.join(dir, entry.name), name, knownNames));
    else files.push(name);
  }
  return files.sort();
}

// 先检查所有旧正文/停用/快照，再执行迁移。歧义和已有目标都保留原文件。
function migrateLegacy(rows, commit = true) {
  const entries = rows.filter((row) => row.kind === 'entry');
  const legacyNames = new Set(entries.map((row) => row.legacyName).filter(Boolean));
  const moves = new Map();
  const addMove = (from, to) => {
    if (!fs.existsSync(from) || from === to) return;
    assert.ok(fs.lstatSync(from).isFile(), '旧作者层项必须是普通文件：' + from);
    assert.ok(!fs.existsSync(to), '迁移目标已存在，原文件已保留：' + to);
    assert.ok(!moves.has(from) || moves.get(from) === to, '旧快照身份有歧义，原文件已保留：' + from);
    moves.set(from, to);
  };
  const findLegacy = (name, file) => {
    const matches = entries.filter((row) => row.legacyName === name);
    assert.ok(matches.length === 1,
      file + ' 无法唯一迁移到 manifest 身份，原文件已保留。请备份作者层，按 list 显示的类型和条目名确认归属，'
      + '将旧正文及快照一起移到对应的新路径后重试。候选：'
      + (matches.map((row) => row.name).join('、') || '当前清单无对应条目'));
    return matches[0];
  };
  for (const dir of [entryDir, path.join(pausedDir, '条目')]) {
    for (const name of layerFiles(dir, '', legacyNames).filter((name) => !name.includes('/'))) {
      const from = path.join(dir, name);
      const row = findLegacy(name, from);
      addMove(from, path.join(dir, row.name));
      const oldSnapshot = path.join(snapshotDir, name);
      assert.ok(!rows.some((other) => other.kind === 'card' && other.snapshot === oldSnapshot)
        || !fs.existsSync(oldSnapshot), '旧快照与卡面快照重名，原文件已保留：' + oldSnapshot);
      addMove(oldSnapshot, row.snapshot);
    }
  }
  const cardSnapshots = new Set(rows.filter((row) => row.kind === 'card').map((row) => path.relative(snapshotDir, row.snapshot)));
  for (const name of layerFiles(snapshotDir, '', new Set([...legacyNames, ...cardSnapshots]))
    .filter((name) => !name.includes('/') && !cardSnapshots.has(name))) {
    const from = path.join(snapshotDir, name);
    const row = findLegacy(name, from);
    addMove(from, row.snapshot);
  }
  const destinations = new Set();
  for (const to of moves.values()) {
    const key = to.toLowerCase();
    assert.ok(!destinations.has(key), '多个旧文件映射到同一迁移目标，原文件已保留：' + to);
    destinations.add(key);
  }
  if (commit) commitMigration(moves);
  return moves;
}

function commitMigration(moves) {
  for (const [from, to] of moves) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
    console.error('提示：已迁移作者层路径 ' + path.relative(root, from) + ' → ' + path.relative(root, to));
  }
}

function claimTargets(migrate = true) {
  const rows = adapter.discover().map((row) => ({
    ...row,
    mine: path.join(row.kind === 'card' ? cardDir : entryDir, row.name),
    snapshot: path.join(snapshotDir, row.kind === 'card' ? '卡面-' + row.name : '条目/' + row.name),
  }));
  const identities = new Set();
  const files = new Set();
  for (const row of rows) {
    assert.ok(!identities.has(row.id), 'adapter 返回了重复身份：' + row.id);
    identities.add(row.id);
    const relative = path.relative(row.kind === 'card' ? cardDir : entryDir, row.mine);
    assert.ok(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative),
      '作者文件必须位于对应目录内：' + row.name);
    // Windows 的大小写规则也在其他平台上检查。
    const file = row.mine.toLowerCase();
    assert.ok(!files.has(file), '作者文件路径碰撞：' + row.name);
    files.add(file);
  }
  if (migrate) migrateLegacy(rows);
  return rows;
}

// 目录里出现无法对应当前协议的文件就报错，防止删除/重命名条目后悄悄失效。
function claimedItems(paused = false, rows = claimTargets(), moves = new Map()) {
  const originals = new Map([...moves].map(([from, to]) => [to, from]));
  for (const kind of ['entry', 'card']) {
    const known = new Set(rows.filter((row) => row.kind === kind).map((row) => row.name));
    const dir = paused ? path.join(pausedDir, kind === 'card' ? '卡面' : '条目')
      : kind === 'card' ? cardDir : entryDir;
    const legacyNames = new Set([...known, ...rows.filter((row) => row.kind === kind)
      .map((row) => row.legacyName).filter(Boolean)]);
    for (const oldName of layerFiles(dir, '', legacyNames)) {
      const oldFile = path.join(dir, oldName);
      const name = path.relative(dir, moves.get(oldFile) ?? oldFile).split(path.sep).join('/');
      assert.ok(known.has(name), path.relative(root, dir) + '/' + name
        + ' 在当前清单里找不到对应身份。请恢复清单或备份并迁移这个文件。');
    }
  }
  return rows.filter((row) => {
    const target = paused ? pausedFile(row) : row.mine;
    const file = originals.get(target) ?? target;
    if (!fs.existsSync(file)) return false;
    assert.ok(fs.lstatSync(file).isFile(), '认领项必须是普通文件：' + file);
    return true;
  });
}

// 核心只提供已认领文件；成品定位和字段写入由 adapter 负责。
export function applyAuthorLayer(worldbook, options) {
  return adapter.applyEntries(worldbook, claimedItems().filter((item) => item.kind === 'entry'), options);
}

export function applyAuthorCardFields(card, options) {
  return adapter.applyCard(card, claimedItems().filter((item) => item.kind === 'card'), options);
}

// 在 forge 读取开场源文本后、注入 initvar/状态栏占位符前调用；保留原 state 路径。
export function resolveAuthorFirstMessage(index, aiSourceText) {
  return adapter.resolveFirstMessage(index, aiSourceText, claimedItems().filter((item) => item.kind === 'card'));
}

// 逐行找出 other 相对 base 的替换块。条目最多几十行，直接算最长公共子序列。
function diffHunks(base, other) {
  const rows = base.length;
  const columns = other.length;
  const width = columns + 1;
  const table = new Int32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i * width + j] = base[i] === other[j]
        ? table[(i + 1) * width + j + 1] + 1
        : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const alignment = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (base[i] === other[j]) {
      alignment.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  const hunks = [];
  let baseCursor = 0;
  let otherCursor = 0;
  for (const [matchedBase, matchedOther] of [...alignment, [rows, columns]]) {
    if (matchedBase > baseCursor || matchedOther > otherCursor) {
      hunks.push({ start: baseCursor, end: matchedBase, lines: other.slice(otherCursor, matchedOther) });
    }
    baseCursor = matchedBase + 1;
    otherCursor = matchedOther + 1;
  }
  return hunks;
}

// 只有双方改到同一段才标出来，其余自动并。
export function mergeThree(base, mine, theirs) {
  const mineHunks = diffHunks(base, mine);
  const theirHunks = diffHunks(base, theirs);
  const clash = (left, right) => left.start === right.start
    || (left.start < right.end && right.start < left.end);

  const lines = [];
  let cursor = 0;
  let conflicts = 0;
  let mineIndex = 0;
  let theirIndex = 0;
  const emitBaseUntil = (target) => {
    while (cursor < target) {
      lines.push(base[cursor]);
      cursor += 1;
    }
  };
  while (mineIndex < mineHunks.length || theirIndex < theirHunks.length) {
    const mineHunk = mineHunks[mineIndex];
    const theirHunk = theirHunks[theirIndex];
    if (mineHunk && theirHunk && clash(mineHunk, theirHunk)) {
      const mineCluster = [mineHunk];
      const theirCluster = [theirHunk];
      mineIndex += 1;
      theirIndex += 1;
      // 收齐传递重叠的修改，直到双方都不能再扩展冲突簇。
      let expanded;
      do {
        expanded = false;
        while (mineIndex < mineHunks.length && theirCluster.some((hunk) => clash(mineHunks[mineIndex], hunk))) {
          mineCluster.push(mineHunks[mineIndex++]);
          expanded = true;
        }
        while (theirIndex < theirHunks.length && mineCluster.some((hunk) => clash(theirHunks[theirIndex], hunk))) {
          theirCluster.push(theirHunks[theirIndex++]);
          expanded = true;
        }
      } while (expanded);
      const cluster = [...mineCluster, ...theirCluster];
      const start = Math.min(...cluster.map((hunk) => hunk.start));
      const end = Math.max(...cluster.map((hunk) => hunk.end));
      const render = (hunks) => {
        const result = [];
        let position = start;
        for (const hunk of hunks) {
          result.push(...base.slice(position, hunk.start), ...hunk.lines);
          position = hunk.end;
        }
        result.push(...base.slice(position, end));
        return result;
      };
      emitBaseUntil(start);
      lines.push(conflictStart, ...render(mineCluster), conflictMiddle, ...render(theirCluster), conflictEnd);
      cursor = end;
      conflicts += 1;
      continue;
    }
    const takeMine = !theirHunk || (mineHunk && mineHunk.start <= theirHunk.start);
    const hunk = takeMine ? mineHunk : theirHunk;
    assert.ok(hunk.start >= cursor, '内部错误：合并位置回退');
    emitBaseUntil(hunk.start);
    lines.push(...hunk.lines);
    cursor = hunk.end;
    if (takeMine) mineIndex += 1;
    else theirIndex += 1;
  }
  emitBaseUntil(base.length);
  return { lines, conflicts };
}

function commandList(keyword) {
  stateNote();
  const rows = claimTargets(false);
  const needle = String(keyword ?? '').toLowerCase();
  const matched = rows.filter(
    (row) => !needle || row.label.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
  );
  if (matched.length === 0) {
    console.log('没有匹配的条目。');
    return;
  }
  for (const row of matched) {
    const legacy = row.legacyName && [entryDir, path.join(pausedDir, '条目')]
      .some((dir) => fs.existsSync(path.join(dir, row.legacyName)));
    console.log(`${fs.existsSync(row.mine) ? '[归我]' : legacy ? '[旧路径待迁移]' : '[归AI]'} ${row.label}`);
    console.log(`  作者路径：${path.relative(root, row.mine).split(path.sep).join('/')}`);
  }
  console.log(`共 ${matched.length} 项；归我的 ${rows.filter((row) => fs.existsSync(row.mine)).length} 项。`);
}

function commandClaim(keyword) {
  const original = String(keyword ?? '').trim();
  const needle = original.toLowerCase();
  if (!needle) {
    console.log('用法：选择 1 之后输入名字的一部分。');
    return;
  }
  const rows = claimTargets();
  const exact = rows.filter((row) => [row.label, row.name, row.id, row.source].includes(original));
  const matched = exact.length ? exact : rows.filter(
    (row) => row.label.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
  );
  if (matched.length === 0) {
    console.log('没有匹配，用选择 3 看全部可认领项。');
    return;
  }
  if (matched.length > 1) {
    console.log(`匹配到 ${matched.length} 项，再输入长一点的名字：`);
    for (const row of matched) console.log(`  ${row.label}`);
    return;
  }
  const [row] = matched;
  if (fs.existsSync(row.mine)) {
    console.log(`${row.label} 已经在你的文件里了，没有被覆盖。`);
    return;
  }
  assert.ok(!fs.existsSync(pausedFile(row)), '这一项已停用，请先 resume 恢复：' + row.label);
  const current = row.aiText();
  writeText(row.mine, current);
  writeText(row.snapshot, current);
  console.log(`已接管 ${row.label}。正文抄到 ${path.relative(root, row.mine).replace(/\\/g, '/')}，改这个文件即可。`);
  console.log(`打开：${row.mine}`);
}

function commandSync() {
  const rows = claimTargets(false);
  const moves = migrateLegacy(rows, false);
  const originals = new Map([...moves].map(([from, to]) => [to, from]));
  const items = claimedItems(false, rows, moves);
  const writes = [];
  const notes = [];
  const toOpen = [];
  for (const item of items) {
    const mineText = readText(originals.get(item.mine) ?? item.mine);
    const aiText = item.aiText();
    const snapshot = originals.get(item.snapshot) ?? item.snapshot;
    if (!fs.existsSync(snapshot)) {
      writes.push([item.snapshot, aiText]);
      notes.push(`· ${item.label}：开始记录 AI 当前版本，下次同步起生效。`);
      continue;
    }
    const snapshotText = readText(snapshot);
    if (snapshotText === aiText) {
      notes.push(`· ${item.label}：AI 没有改动。`);
      continue;
    }
    const merged = mergeThree(snapshotText.split('\n'), mineText.split('\n'), aiText.split('\n'));
    writes.push([item.mine, merged.lines.join('\n')], [item.snapshot, aiText]);
    if (merged.conflicts > 0) toOpen.push(item.mine);
    notes.push(
      merged.conflicts === 0
        ? `· ${item.label}：AI 的新改动已并进你的文件。`
        : `· ${item.label}：有 ${merged.conflicts} 处双方都改到同一段，已在你的文件里用 ${conflictStart} / ${conflictMiddle} / ${conflictEnd} 标出，两份都留着，改完删掉这三行标记即可。`,
    );
  }
  // 所有 adapter/config/template 读取与合并成功后，才执行迁移和写入。
  ensureGitIgnore();
  commitMigration(moves);
  for (const [file, value] of writes) writeText(file, value);
  if (items.length === 0) notes.push('你还没有认领任何东西。');
  for (const note of notes) console.log(note);
  for (const file of toOpen) console.log(`打开：${file}`);
}

// 取消认领：这一项还给 AI，你的正文留在 作者层/已取消/ 备查，不再参与封装。
function commandRelease(keyword) {
  const original = String(keyword ?? '').trim();
  const needle = original.toLowerCase();
  if (!needle) {
    console.log('用法：选择 7 之后按编号选。');
    return;
  }
  const rows = claimTargets();
  const exact = rows.filter((row) => [row.label, row.name, row.id, row.source].includes(original));
  const matched = exact.length ? exact : rows.filter(
    (row) => row.label.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle) || row.id.toLowerCase().includes(needle),
  );
  if (matched.length === 0) {
    console.log('没有匹配，用选择 3 看全部可认领项。');
    return;
  }
  if (matched.length > 1) {
    console.log(`匹配到 ${matched.length} 项，再输入长一点的名字：`);
    for (const row of matched) console.log(`  ${row.label}`);
    return;
  }
  const [row] = matched;
  const from = [row.mine, pausedFile(row)].find((file) => fs.existsSync(file));
  if (!from) {
    console.log(`${row.label} 不在你名下，不用取消。`);
    return;
  }
  const archiveDir = path.join(layerDir, '已取消', section(row), path.dirname(row.name));
  fs.mkdirSync(archiveDir, { recursive: true });
  const extension = path.extname(row.name);
  let archived = path.join(archiveDir, path.basename(row.name));
  for (let n = 2; fs.existsSync(archived); n += 1) {
    archived = path.join(archiveDir, `${path.basename(row.name, extension)}-${n}${extension}`);
  }
  fs.renameSync(from, archived);
  if (fs.existsSync(row.snapshot)) fs.unlinkSync(row.snapshot);
  const relative = (file) => path.relative(root, file).split(path.sep).join('/');
  console.log(`已取消认领 ${row.label}：以后封装按 AI 的版本走。你的正文留在 ${relative(archived)}，想恢复就把它挪回 ${relative(row.mine)}。`);
}

function commandStatus() {
  stateNote();
  const items = claimedItems();
  console.log(`归我的：${items.length} 项`);
  const paused = pausedNames();
  if (paused.length > 0) console.log(`停用中：${paused.length} 项（在 ${config.layerDir}/停用/，本次封装不会带上）`);
  for (const item of items) {
    const mineText = readText(item.mine);
    const aiText = item.aiText();
    if (!fs.existsSync(item.snapshot)) {
      console.log(`· ${item.label}：${mineText === aiText ? '你还没改' : '你已改过'} · 还没记录 AI 版本，下次同步时记录。`);
      continue;
    }
    const snapshotText = readText(item.snapshot);
    const mySide = mineText === snapshotText ? '你还没改' : '你已改过';
    const aiSide = snapshotText === aiText ? 'AI 没动过' : 'AI 有新改动（选 2 同步才会并进来）';
    console.log(`· ${item.label}：${mySide} · ${aiSide}`);
  }
}

function commandCount() {
  console.log(claimedItems().length);
}

function commandLayer() {
  console.log(layerDir);
}

function pausedNames() {
  return claimedItems(true).map((row) => row.name);
}

function moveItems(items, pause) {
  const moves = items.map((row) => {
    const paused = pausedFile(row);
    return pause ? { from: row.mine, to: paused } : { from: paused, to: row.mine };
  });
  for (const { to } of moves) assert.ok(!fs.existsSync(to), `目标已存在同名文件：${to}`);
  for (const { from, to } of moves) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.renameSync(from, to);
  }
}

// 停用：把文件挪出 条目/ 与 卡面/，封装就不带；文件内容不动。
function commandPause() {
  const items = claimedItems();
  if (items.length === 0) {
    const paused = pausedNames().length;
    console.log(paused > 0 ? `已经是停用状态：${paused} 项在 ${config.layerDir}/停用/，封装不会带上。` : '你还没有认领任何东西。');
    return;
  }
  moveItems(items, true);
  console.log(`已停用 ${items.length} 项：这次封装不会带上你的内容（文件在 ${config.layerDir}/停用/，随时恢复）。`);
}

function commandResume() {
  const items = claimedItems(true);
  if (items.length === 0) {
    console.log('没有停用的内容需要恢复。');
    return;
  }
  moveItems(items, false);
  console.log(`已恢复 ${items.length} 项：封装会带上你的版本。`);
}

function commandToggle() {
  if (pausedNames().length > 0) commandResume();
  else commandPause();
}

function upsertRule(file, create) {
  if (!fs.existsSync(file)) {
    if (!create) return null;
    writeText(file, `# 项目约定\n\n${ruleBlock}\n`);
    return 'created';
  }
  const text = readText(file);
  const start = text.indexOf(ruleStart);
  const end = text.indexOf(ruleEnd);
  if (start >= 0 && end > start) {
    if (text.slice(start, end + ruleEnd.length) === ruleBlock) return 'ok';
    writeText(file, text.slice(0, start) + ruleBlock + text.slice(end + ruleEnd.length));
    return 'updated';
  }
  writeText(file, `${text.replace(/\n*$/, '\n')}\n${ruleBlock}\n`);
  return 'appended';
}

// 在项目根写入/刷新作者层规则；ruleFiles 里的第一个文件不存在就创建，其余只在已经存在时同步。
function commandInstallRule() {
  const notes = [];
  config.ruleFiles.forEach((file, index) => {
    const result = upsertRule(path.join(root, file), index === 0);
    if (result === 'created') notes.push(`${file}：已写入作者层规则`);
    if (result === 'updated') notes.push(`${file}：作者层规则已刷新`);
    if (result === 'appended') notes.push(`${file}：已补上作者层规则`);
  });
  console.log(notes.length > 0 ? notes.join('\n') : '作者层规则已是当前版本。');
  console.log(`.gitignore 已加入 ${config.layerDir}/ 的 Git 忽略保护。`);
}

// 供启动脚本列出「归我的」编号、名字、路径。
function commandMine() {
  const items = claimedItems();
  if (items.length === 0) {
    console.log('你还没有认领任何东西。');
    return;
  }
  items.forEach((item, index) => {
    console.log(`${index + 1}\t${item.label}\t${item.mine}`);
  });
}

function printHelp() {
  console.log('用法：node tools/author-layer.mjs <list|claim|release|sync|status|mine|pause|resume|toggle|count|layer|install-rule> [关键词]');
  console.log('  list [关键词]  列出可认领项与归属');
  console.log(`  claim 关键词   认领一项，当前正文抄进 ${config.layerDir}/`);
  console.log(`  release 关键词 取消认领，这一项还给 AI（你的正文留档到 ${config.layerDir}/已取消/）`);
  console.log('  sync           把 AI 的新改动并进你的文件');
  console.log('  status         查看归属与同步状态');
  console.log('  count          只输出归你的项数（供启动脚本使用）');
  console.log('  mine           列出归你的项（编号、名字、路径）');
  console.log('  layer          输出作者层目录的绝对路径（供启动脚本使用）');
  console.log('  pause / resume 停用或恢复你的全部内容（决定封装是否带上）');
  console.log('  toggle         在停用与恢复之间切换');
  console.log(`  install-rule   在项目根写入/刷新 ${config.ruleFiles.join('、')} 里的作者层规则`);
}

const commands = {
  list: commandList,
  claim: commandClaim,
  sync: commandSync,
  release: commandRelease,
  status: commandStatus,
  mine: commandMine,
  pause: commandPause,
  resume: commandResume,
  toggle: commandToggle,
  'install-rule': commandInstallRule,
  count: commandCount,
  layer: commandLayer,
};

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const [command, ...args] = process.argv.slice(2);
  const handler = commands[command];
  if (!handler) {
    printHelp();
    if (command) process.exitCode = 1;
  } else {
    try {
      handler(args.join(' '));
    } catch (error) {
      console.error(`失败：${error.message}`);
      process.exitCode = 1;
    }
  }
}
