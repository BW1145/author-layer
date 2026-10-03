import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Protocol source: ai4rpg/tavern-cards e28fb561f114a4c0636921878c245e5fc181bf33
// references/type/state.ts; scripts/tavern-cards-forge.mjs (resolve_files, to_raw, build).
export const defaults = {
  stateFile: 'tavern-cards-state.json',
  cardFields: [
    { key: 'name', file: '名称.txt', label: '卡面 · 名称' },
    { key: 'description', file: '描述.txt', label: '卡面 · 描述' },
    { key: 'personality', file: '性格.txt', label: '卡面 · 性格' },
    { key: 'scenario', file: '场景.txt', label: '卡面 · 场景' },
    { key: 'first_mes', file: '开场白.txt', label: '卡面 · 开场白' },
    { key: 'mes_example', file: '对话示例.txt', label: '卡面 · 对话示例' },
  ],
};

const identity = (group, name) => JSON.stringify([group, name]);
// 可读前缀 + 身份摘要，兼顾 Windows 大小写、保留名、非法字符与末尾空格/点。
const component = (text) => `_${text.replace(/[<>:"/\\|?*%\x00-\x1f]/g, (c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0').toUpperCase()}`)
  .replace(/[. ]+$/g, (s) => [...s].map((c) => `%${c.charCodeAt(0).toString(16)}`).join(''))
  .slice(0, 64)}~${createHash('sha256').update(text).digest('hex').slice(0, 12)}`;
const normalizePath = (value) => value.replace(/\\/g, '/');
const fragmentKey = (value) => normalizePath(value).replace(/\.(yaml|yml|txt|md|json)$/, '');

export function createAdapter({ root, config, readText, readJson }, readCardField) {
  const statePath = path.resolve(root, config.stateFile);
  const resolve = (value) => path.resolve(root, normalizePath(value));
  const readState = () => fs.existsSync(statePath) ? readJson(statePath) : {};
  const openingText = (value) => {
    // 与 forge 的 resolveInlineOrFile 一致：多行内容是正文；已存在的已知后缀文件才读取。
    if (!value.includes('\n') && /\.(txt|md|json|yaml|yml|html)$/.test(value)
      && fs.existsSync(resolve(value))) return readText(resolve(value));
    return value;
  };

  function discover() {
    const state = readState();
    const rows = [];
    for (const field of config.cardFields) {
      const isOpening = field.key === 'first_mes';
      rows.push({
        kind: 'card', id: isOpening ? 'first_messages[0]' : `card:${field.key}`,
        key: field.key, index: isOpening ? 0 : undefined,
        name: field.file, label: field.label,
        aiText: () => isOpening ? openingText(state.first_messages?.[0] ?? '')
          : String(readCardField ? readCardField(field.key, state)
            : state[field.key === 'name' ? 'projectName' : field.key] ?? ''),
      });
      if (isOpening) {
        for (let i = 1; i < (state.first_messages ?? []).length; i += 1) {
          rows.push({
            kind: 'card', id: `first_messages[${i}]`, key: 'alternate_greetings', index: i,
            name: `开场白/${i}.txt`, label: `卡面 · 开场白[${i}]`,
            source: state.first_messages[i], aiText: () => openingText(state.first_messages[i]),
          });
        }
      }
    }
    const manifest = state.entryManifest ?? {};
    const fragmentPaths = new Set();
    for (const items of Object.values(manifest)) {
      for (const leaf of Object.values(items)) {
        for (const fragment of leaf.contents ?? []) {
          if (fragment.file) fragmentPaths.add(fragmentKey(fragment.file));
        }
      }
    }
    for (const [group, items] of Object.entries(manifest)) {
      for (const [comment, leaf] of Object.entries(items)) {
        // forge 不单独输出已被组合条目引用的片段。
        if (leaf.path && fragmentPaths.has(fragmentKey(leaf.path))) continue;
        const source = leaf.path ? normalizePath(leaf.path) : undefined;
        const extension = source ? path.posix.extname(source) : '.txt';
        rows.push({
          kind: 'entry', id: identity(group, comment), group, comment, source,
          name: `${component(group)}/${component(comment)}${extension}`,
          legacyName: source ? path.posix.basename(source) : undefined,
          label: `${group} · ${comment}${source ? ` · ${source}` : ''}`,
          aiText: () => leaf.contents
            ? leaf.contents.map((fragment) => fragment.file
              ? readText(resolve(fragment.file)) : String(fragment.content ?? '')).join('\n')
            : source ? readText(resolve(source)) : '',
        });
      }
    }
    return rows;
  }

  function applyEntries(worldbook, items, { entryIdentities = {} } = {}) {
    const entries = worldbook.entries;
    assert.ok(entries && typeof entries === 'object', '组装结果缺少 entries。');
    const manifestRows = discover().filter((row) => row.kind === 'entry');
    const assignments = items.map((item) => {
      const candidates = Object.entries(entries).filter(([key, entry]) => {
        if (Object.hasOwn(entryIdentities, key)) {
          const pair = entryIdentities[key];
          assert.ok(Array.isArray(pair) && pair.length === 2 && pair.every((s) => typeof s === 'string'),
            `entryIdentities[${key}] 必须是 [类型, 条目名称]。`);
          assert.ok(manifestRows.some((row) => row.id === identity(...pair)),
            `entryIdentities[${key}] 的身份不在当前 manifest 中。`);
          return identity(...pair) === item.id;
        }
        return entry.comment === item.comment;
      });
      const ambiguousName = manifestRows.filter((row) => row.comment === item.comment).length > 1;
      assert.ok(candidates.length === 1 && (!ambiguousName
        || Object.hasOwn(entryIdentities, candidates[0][0])),
      `${item.label} 无法唯一对应组装条目；请向 applyAuthorLayer 传入 entryIdentities（成品键 → [类型, 条目名称]）。`);
      return { entry: candidates[0][1], value: readText(item.mine) };
    });
    // 全部身份校验成功后才覆盖，避免半份成品。
    for (const { entry, value } of assignments) entry.content = value;
    return assignments.length;
  }

  function applyCard(card, items) {
    assert.ok(card?.data && typeof card.data === 'object' && !Array.isArray(card.data), '成品卡缺少 data 对象。');
    const assignments = items.map((item) => {
      const value = readText(item.mine);
      if (item.key === 'alternate_greetings') {
        assert.ok(Array.isArray(card.data.alternate_greetings)
          && item.index - 1 < card.data.alternate_greetings.length,
        `${item.label} 不在成品 alternate_greetings 中，请先按当前 state 构建全部开场白。`);
      }
      return { item, value };
    });
    for (const { item, value } of assignments) {
      if (item.key === 'alternate_greetings') {
        card.data.alternate_greetings[item.index - 1] = value;
        if (Array.isArray(card.alternate_greetings)) card.alternate_greetings[item.index - 1] = value;
      } else {
        card.data[item.key] = value;
        if (item.key in card) card[item.key] = value;
      }
    }
    return items.length;
  }

  return {
    discover, applyEntries, applyCard,
    note: () => fs.existsSync(statePath) ? '' : `提示：根目录没有 ${config.stateFile}，清单按空处理，可认领项只有卡面字段。`,
  };
}
