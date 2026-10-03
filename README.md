# 角色卡作者层工具

把一张卡里「你自己写的内容」和「AI 维护的内容」分开。你认领的部分放在 `作者层/` 下，封装时盖回对应世界书条目和卡面字段；AI 改动原稿之后，可以把它并进你的文件。

默认支持 TavernWeave 使用的 ai4rpg/tavern-cards state 协议。核心管理作者文件、快照、三路合并、认领、同步、停用恢复和 Git 隐私保护；`tools/adapters/tavern-cards.mjs` 负责发现条目、读取底稿和覆盖成品。只使用 Node 内置模块，无需安装依赖。adapter 由配置明确选择。

## 装到角色卡工作区

把下面这些文件复制到项目根目录，保留 `tools/` 内的目录结构：

```text
我的改动.cmd
我的改动.ps1
tools/
  author-layer.mjs
  adapters/
    tavern-cards.mjs
    template-compat.mjs
author-layer.config.json     （可选）
```

需要支持 `import.meta.dirname` / `import.meta.filename` 的 Node.js（Node 22 或更新版本）。项目根由 `tools/author-layer.mjs` 所在目录的上一层确定。

双击 `我的改动.cmd` 打开菜单。启动器会补充项目的作者层规则：`AGENTS.md` 不存在时创建，`CLAUDE.md` 已存在时同步。工具运行或被封装器导入时，会确保 `.gitignore` 保护当前 `layerDir`；提示写入 stderr，`count`、`layer` 的 stdout 格式供启动器继续使用。

## 目录与身份

世界书条目的身份是 manifest 中的 **类型 + 条目名称**。完整源路径也可以用于命令选择，例如 `claim 世界书/NPC/基础信息.yaml`。两个不同目录里的 `基础信息.yaml` 可以分别认领；仅输入这个共同文件名时，菜单会列出候选供你缩小关键词。

| 位置 | 作用 |
| --- | --- |
| `作者层/条目/<类型编码>/<条目名编码>.<原扩展名>` | 认领的世界书正文；组合正文使用 `.txt` |
| `作者层/卡面/` | 配置的卡面字段，如 `名称.txt`、`开场白.txt` |
| `作者层/卡面/开场白/1.txt`、`2.txt`… | 第 1、2…个备用开场白 |
| `作者层/快照/条目/<类型编码>/<条目名编码>.<扩展名>` | 上次同步的 AI 条目底稿 |
| `作者层/快照/卡面-<字段文件>` | 上次同步的 AI 卡面底稿，沿用已有卡面快照路径 |
| `作者层/停用/条目/`、`停用/卡面/` | 暂时停用的认领文件，保留相同相对路径 |
| `作者层/已取消/条目/`、`已取消/卡面/` | 取消认领后留档的正文 |

类型和条目名编码保留可读前缀，转义 Windows 非法字符，并附加 12 位 SHA-256 摘要，区分大小写、保留名和编码后重名。路径碰撞会报错。`list` 显示实际作者文件路径。修改源路径但保持类型、条目名与扩展名不变时，认领身份和存储位置保持不变；更改身份或扩展名时需迁移已有作者文件和快照。

## state 契约与配置

默认 adapter 的底稿来源是 `tavern-cards-state.json`：

| state 字段 | 成品字段 / 作者文件 |
| --- | --- |
| `projectName` | `name` / `名称.txt` |
| `description` | `description` / `描述.txt` |
| `personality` | `personality` / `性格.txt` |
| `scenario` | `scenario` / `场景.txt` |
| `mes_example` | `mes_example` / `对话示例.txt` |
| `first_messages[0]` | `first_mes` / `开场白.txt` |
| `first_messages[i]`，`i >= 1` | `alternate_greetings[i - 1]` / `开场白/i.txt` |
| `entryManifest[类型][条目名称]` | 世界书条目正文 |

世界书 leaf 支持 `path` 和有序 `contents`；`contents` 中的 `file` 读取文件，`content` 使用内联文本，片段以换行连接。与 forge 一致，已被组合正文引用的片段 leaf 不单独列为认领项，应认领输出的组合条目。

开场白支持内联文本和文件路径。与上游一致，单行且以 `.txt/.md/.json/.yaml/.yml/.html` 结尾、对应文件已存在时读取文件，否则作为正文。每个数组位置独立认领和同步，覆盖成品时保留其他未认领开场白。认领的是**数组位置**：重排 state 数组后，文件仍属于原编号，会与该位置的新正文同步；请按需要先取消认领再重新认领。删除仍被认领的备用位置会报错并保留作者文件。配置保留 `first_mes` 时会自动列出全部备用开场白。

`author-layer.config.json` 全部可省略：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `adapter` | `tavern-cards` | 协议选择；另有显式模板兼容路径 `template-compat` |
| `layerDir` | `作者层` | 项目内子目录，可嵌套；同步写入 Git 忽略规则 |
| `stateFile` | `tavern-cards-state.json` | 不存在时使用空清单、空卡面底稿；错误 JSON 会报出文件路径 |
| `ruleFiles` | `["AGENTS.md", "CLAUDE.md"]` | 第一个不存在时创建，其余仅在已存在时同步 |
| `cardFields` | 名称、描述、性格、场景、开场白、对话示例 | 每项有 `key`、`file`、`label`；可添加 `system_prompt` 等 state 文本字段；文件路径需在卡面目录内且互不碰撞 |
| `ruleMarkdown` | 内置规则 | 替换规则正文，两行管理标记由工具加入 |

模板兼容项目可以显式设置：

```json
{
  "adapter": "template-compat",
  "cardConfigFile": "card-build.config.json"
}
```

该路径的名称、描述和开场白仍来自 state，其余卡面字段从 `inputs.cardTemplate` 指定模板的 `data` 读取。缺少配置、模板路径、有效 `data` 或错误 JSON 都会明确报错。默认 `tavern-cards` 使用 state 卡面文本字段。

## 旧作者层数据迁移

升级时先备份整个作者层目录，包括快照和停用目录，并复制完整新版 `tools/`。

工具在读取归属或执行认领、同步、封装等操作前，会检查旧的 basename 布局，例如 `作者层/条目/story.md` 与 `作者层/快照/story.md`。旧 basename 在当前 manifest 中唯一对应时，正文、停用正文与快照一起迁移到新身份路径。提示只包含路径，写到 stderr；卡面字段和已有卡面快照继续沿用。旧快照即使暂时没有正文，也会按相同规则检查和迁移。

迁移前会检查所有旧文件的归属和目标。basename 对应多个条目、条目已移除、目标已有文件或旧快照与卡面快照重名时，操作中止，保留原文件，显示原因与候选路径。处理方法：

1. 运行 `node tools/author-layer.mjs list`，查看每个条目的类型、名称、源路径和作者路径。`list` 只展示映射，迁移受阻时也可使用。
2. 确认旧正文属于哪个条目，把它移到显示的作者路径；停用文件放到 `作者层/停用/条目/` 下的相同相对路径。
3. 把对应旧快照移到 `作者层/快照/条目/` 下的相同相对路径。快照保存的是此前 AI 底稿，迁移时保持其原有内容。
4. 目标已有文件时，先在备份中保留两份并由你确定采用哪一份；归属无法确定的文件移入备份目录后再操作。重试 `status` 确认归属。

当前作者目录中无法对应 manifest 的文件也会阻止同步或封装。未注册为认领项的编辑器点文件、`~` 临时文件不参与；命名子目录中的正文同样会检查。认领、停用、恢复和取消认领支持 `.md`、`.json`、`.yaml` 等扩展名，移动前检查全部目标并保留已有文件。

## 命令

菜单操作保持原样，也可运行 `node tools/author-layer.mjs <命令>`：

| 命令 | 作用 |
| --- | --- |
| `status` | 查看归属与同步状态 |
| `list [关键词]` | 列出可认领项、归属和作者路径 |
| `claim 关键词` | 认领一项；完整源路径、完整菜单名称或 `first_messages[1]` 等身份优先精确匹配 |
| `sync` | 把 AI 新改动并进作者文件 |
| `mine` | 输出归你的项（编号、名称、绝对路径） |
| `toggle` / `pause` / `resume` | 停用或恢复全部认领内容 |
| `release 关键词` | 取消认领，正文留档 |
| `count` | 只输出有效认领项数 |
| `layer` | 输出作者层目录的绝对路径 |
| `install-rule` | 写入或刷新项目作者层规则 |

## 封装器接入

封装器在成品对象构建完成、写出 JSON 或嵌入 PNG 前调用导出函数；forge 本身需要这一调用接入作者层。

```js
import { applyAuthorLayer, applyAuthorCardFields } from './tools/author-layer.mjs';

applyAuthorLayer(worldbook);                  // 独立世界书
applyAuthorLayer(card.data.character_book);   // 卡内世界书，若单独构建
applyAuthorCardFields(card);                  // 卡面及多个开场白
```

两个函数都返回覆盖项数。`applyAuthorLayer` 支持对象或数组形式的 `entries`；默认用上游输出的 `comment` 对应 manifest 条目名，并要求名称在 manifest 和成品中都唯一。成品里有同名条目时，封装器保留创建时的 manifest 身份，传入一份显式映射：

```js
applyAuthorLayer(worldbook, {
  entryIdentities: {
    0: ['角色', '基础信息'],
    1: ['NPC', '基础信息'],
  },
});
```

映射键是 `worldbook.entries` 中的键，数组形式则是下标；值为 `[类型, 条目名称]`。同名条目的映射由构建器创建条目时记录，不能靠成品的顺序或正文反推。缺少唯一对应关系时中止覆盖。成品里的 `alternate_greetings` 需先由构建器按当前 state 生成，再由作者层逐位置覆盖。

轻量 adapter 接口是 `defaults` 和 `createAdapter({ root, config, readText, readJson })`。返回的 `discover()` 提供身份、相对作者文件名、菜单名称、`aiText()` 底稿读取函数及可选旧文件名；`applyEntries()` / `applyCard()` 接收核心确认的认领项，处理成品映射；`note()` 提供缺少 state 等状态提示。增加其他协议时实现这个边界并在核心的选择表注册即可，文件生命周期与合并算法继续复用。

## 三路合并

认领时保存 AI 当时的正文作为快照。`sync` 使用快照、作者当前正文和 AI 当前正文做逐行三路合并：不同位置的改动自动合并；重叠修改或同一基线位置的双方插入生成冲突标记，保留两份内容：

文件中的标记依次为 `<<<<<<< 我的写法`、`=======`、`>>>>>>> AI新改`，中间分别保留作者内容和 AI 内容。

你确定采用的内容后删除标记。大替换块与多个小替换块及传递重叠修改组成一个完整冲突段，保留段内未改动行。同位置插入即使文字相同也按冲突处理，交由作者决定。

## Git 隐私保护

工具会把管理段放到 `.gitignore` 末尾，保留其他规则，并随 `layerDir` 更新：

```gitignore
# author-layer private content (managed)
/作者层/
# end author-layer private content
```

忽略规则保护未跟踪文件。已经被 Git 跟踪的私人文件需要由你从索引移除；历史提交中的内容不受忽略规则影响。

## 协议依据与验证

协议依据：[ai4rpg/tavern-cards state schema](https://github.com/ai4rpg/tavern-cards/blob/e28fb561f114a4c0636921878c245e5fc181bf33/tavern-cards/references/type/state.ts) 和同一提交的 [forge 组装实现](https://github.com/ai4rpg/tavern-cards/blob/e28fb561f114a4c0636921878c245e5fc181bf33/tavern-cards/scripts/tavern-cards-forge.mjs)。这是离线构建协议对齐，封装调用需在目标项目接入；酒馆运行时扩展不参与此工具执行。

运行 `node --test`、对 `tools/author-layer.mjs`、`tools/adapters/*.mjs`、`tests/author-layer.test.mjs` 逐个执行 `node --check`，以及 `git diff --check`。测试覆盖无 UID 清单、重名源文件、state 文本字段、多开场白、组合正文、合并冲突簇、旧布局迁移、Git 忽略规则、停用恢复和模板错误。测试使用临时项目，Git 忽略检查需要本机安装 Git。
