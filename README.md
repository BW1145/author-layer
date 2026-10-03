# 角色卡作者层工具

把一张卡里「你自己写的内容」和「AI 维护的内容」分开。你认领的部分放在 `作者层/` 下，封装时自动盖回清单条目和卡面字段；AI 改动原稿之后，再把它并进你的文件。

工具本身不知道自己在哪个盘、哪个目录：项目根由 `tools/author-layer.mjs` 的位置反推（`tools/` 的上一层），目录名、文件名、卡面字段全部由项目根下的 `author-layer.config.json` 决定，不写就用内置默认值。只用 Node 内置模块，没有 `node_modules`，也不需要联网。

## 装到别的工作区

把下面四项复制进目标项目根目录就行了：

```
我的改动.cmd
我的改动.ps1
tools/author-layer.mjs
author-layer.config.json     （可选；不放就用内置默认值）
```

前提是机器上有 `node`（`node --version` 能跑通）。装好后双击 `我的改动.cmd` 打开菜单。目标项目里原有的 `AGENTS.md` 会被补上作者层规则段，没有就新建一个；`CLAUDE.md` 只在它本来就存在时才同步。工具每次运行或被封装器导入时，也会确保 `.gitignore` 包含当前 `layerDir` 的忽略规则；更新时提示写到 stderr，`count`、`layer` 的 stdout 格式保持原样。

## 目录约定

工具会在项目根下维护这些位置（名字可在配置里改）：

| 位置 | 作用 |
| --- | --- |
| `作者层/条目/` | 你认领的世界书条目，文件名与清单里的源文件同名 |
| `作者层/卡面/` | 你认领的卡面字段，如 `名称.txt`、`描述.txt` |
| `作者层/快照/` | 记录上一次同步时 AI 那一份的样子，用来算三路合并 |
| `作者层/停用/` | 临时挪出去的内容，这次封装不带 |
| `作者层/已取消/` | 取消认领后留档的正文 |

## 配置项

`author-layer.config.json` 全部可省略：

| 键 | 默认值 | 说明 |
| --- | --- | --- |
| `layerDir` | `作者层` | 存放你自己内容的项目内子目录，也支持嵌套目录；同步写入 `.gitignore` 管理段 |
| `stateFile` | `tavern-cards-state.json` | 清单文件；不在时按空清单运行 |
| `cardConfigFile` | `card-build.config.json` | 从这里读 `inputs.cardTemplate` 拿卡面底稿 |
| `ruleFiles` | `["AGENTS.md", "CLAUDE.md"]` | 写入作者层规则的文件；第一个不存在会创建，其余只在已存在时同步 |
| `cardFields` | 名称、描述、性格、场景、开场白、对话示例 | 可认领的卡面字段，每项写 `key`、`file`（文件名）、`label`（菜单里的名字） |
| `ruleMarkdown` | 内置那段 | 整段替换写进规则文件的正文（两行标记由工具自己加） |

清单文件（`stateFile`）用 `entryManifest` 分组列出条目，每条带 `path`（源文件路径）和 `uid`。`projectName` 和 `description` 就是名称、描述的底稿；`first_messages` 是开场白源文件路径的列表，取第一个当开场白底稿。`性格`、`场景`、`对话示例` 三个字段的底稿来自卡面模板里的 `data`。

配置的 `cardFields` 若只包含 `name`、`description`、`first_mes`，或为空，只需 state；包含其他字段时，需要合法的 `cardConfigFile`、`inputs.cardTemplate` 路径和带 `data` 对象的模板 JSON。缺失文件或格式错误会显示具体路径与原因，并中止操作。

## 命令

菜单里都有，也可以直接跑 `node tools/author-layer.mjs <命令>`：

| 命令 | 作用 |
| --- | --- |
| `status` | 看归属与同步状态 |
| `list [关键词]` | 列出全部可认领项与归属 |
| `claim 关键词` | 认领一项，当前正文抄进 `作者层/` |
| `sync` | 把 AI 的新改动并进你的文件 |
| `mine` | 列出归你的项（编号、名字、路径） |
| `toggle` / `pause` / `resume` | 停用或恢复你的全部内容 |
| `release 关键词` | 取消认领，正文留档到 `作者层/已取消/` |
| `count` | 只输出归你的项数 |
| `layer` | 输出作者层目录的绝对路径 |
| `install-rule` | 在项目根写入/刷新作者层规则 |

封装器侧可以 `import` 本模块的两个函数，把作者层盖进成品：

```js
import { applyAuthorLayer, applyAuthorCardFields } from './tools/author-layer.mjs';
```

`applyAuthorLayer(worldbook)` 按 `uid` 换掉条目正文，`applyAuthorCardFields(card)` 覆盖卡面字段，两个都返回合并了多少项。

## 同步是怎么合的

认领时记一份 AI 当时的正文当底稿。之后 AI 改了原稿、你也改了自己的文件，`sync` 拿这三份做三路合并：两边改到不同位置自动并；只有改到同一段才在文件里插 `<<<<<<< 我的写法` / `=======` / `>>>>>>> AI新改` 三行标记，两份都留着，你改完删掉标记即可。多处传递重叠的修改会组成一个完整冲突段，保留双方修改及段内未改动的行。

## 注意

`作者层/` 里是私人内容。工具只按文件名对应关系读写，不做内容检查；`作者层/条目/` 或 `作者层/卡面/` 里出现清单里没有的名字时，会直接报错停下，避免悄悄失效。

认领、停用和恢复以清单条目及配置的卡面字段为准，支持 `.md`、`.json` 等扩展名。移动前会验证认领文件与全部目标路径，目标有同名文件就报错，保留现有文件；编辑器临时文件和无关子目录不参与移动。

`.gitignore` 的管理段放在文件末尾，保留其他规则，并随 `layerDir` 更新：

```gitignore
# author-layer private content (managed)
/作者层/
# end author-layer private content
```

Git 忽略规则保护未跟踪文件。已经被 Git 跟踪的私人文件，需要由你从 Git 索引中移除；历史提交中的内容不受忽略规则影响。

## 测试

在本仓库运行 `node --test tests/author-layer.test.mjs`，验证三路合并、Git 忽略规则、认领与停用恢复、模板错误及封装器导入。测试使用临时项目和 Node 内置测试模块，Git 忽略检查需要本机安装 Git。
