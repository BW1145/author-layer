import assert from 'node:assert/strict';
import path from 'node:path';
import { createAdapter as createTavernCards, defaults as stateDefaults } from './tavern-cards.mjs';

// 显式选择的模板兼容路径；世界书仍使用 manifest 身份。
export const defaults = { ...stateDefaults, cardConfigFile: 'card-build.config.json' };

export function createAdapter(context) {
  const { root, config, readJson } = context;
  const stateFields = new Set(['name', 'description']);
  return createTavernCards(context, (key, state) => {
    if (stateFields.has(key)) return state[key === 'name' ? 'projectName' : key] ?? '';
    const configPath = path.resolve(root, config.cardConfigFile);
    const template = readJson(configPath)?.inputs?.cardTemplate;
    assert.ok(typeof template === 'string' && template.trim(), `${configPath} 缺少有效的 inputs.cardTemplate 路径。`);
    const templatePath = path.resolve(root, template.replace(/\\/g, '/'));
    const card = readJson(templatePath);
    assert.ok(card?.data && typeof card.data === 'object' && !Array.isArray(card.data),
      `${templatePath} 缺少有效的 data 对象。`);
    return card.data[key] ?? '';
  });
}
