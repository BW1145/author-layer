[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()

$tool = Join-Path $PSScriptRoot 'tools/author-layer.mjs'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host '找不到 node，无法运行。'
    exit 1
}

Write-Host ''
Write-Host '归你的内容只有你自己改，AI 照旧维护它那份；封装时自动合并。'
Write-Host ''

$ruleNote = @(& node $tool install-rule) -join "`n"
if ($ruleNote -and $ruleNote -ne '作者层规则已是当前版本。') {
    Write-Host $ruleNote
    Write-Host ''
}

function Show-AndOpen([string[]]$lines) {
    foreach ($line in $lines) { Write-Host $line }
    foreach ($line in $lines) {
        if ($line -like '打开：*') { & explorer.exe ($line.Substring(3).Trim()) }
    }
}

while ($true) {
    & node $tool status
    Write-Host ''
    Write-Host '  1  认领一项（世界书条目，或卡面基础信息）'
    Write-Host '  2  同步 AI 的新改动到我的文件'
    Write-Host '  3  列出全部可认领项和归属'
    Write-Host '  4  打开作者层文件夹'
    Write-Host '  5  打开我认领的内容（按编号选）'
    Write-Host '  6  停用/恢复我的内容（出一版不带我内容的）'
    Write-Host '  7  取消认领（把某项还给 AI，你的正文留档）'
    Write-Host '  0  退出'
    $choice = "$(Read-Host '输入编号')".Trim()
    switch ($choice) {
        '1' {
            $keyword = Read-Host '输入名字的一部分，例如 描述 或 开放日'
            Show-AndOpen (& node $tool claim $keyword)
        }
        '2' { Show-AndOpen (& node $tool sync) }
        '3' {
            $keyword = Read-Host '可输入关键词过滤，直接回车看全部'
            Show-AndOpen (& node $tool list $keyword)
        }
        '4' { & explorer.exe (& node $tool layer) }
        '5' {
            $rows = @(& node $tool mine)
            $paths = @{}
            foreach ($row in $rows) {
                $parts = $row -split "`t"
                if ($parts.Count -lt 3) { Write-Host $row; continue }
                $paths[$parts[0]] = $parts[2]
                Write-Host ("  {0}  {1}" -f $parts[0], $parts[1])
            }
            if ($paths.Count -gt 0) {
                $pick = "$(Read-Host '输入编号打开，直接回车返回')".Trim()
                if ($pick -and $paths.ContainsKey($pick)) { & explorer.exe $paths[$pick] }
            }
        }
        '6' { Show-AndOpen (& node $tool toggle) }
        '7' {
            $rows = @(& node $tool mine)
            $labels = @{}
            foreach ($row in $rows) {
                $parts = $row -split "`t"
                if ($parts.Count -lt 3) { Write-Host $row; continue }
                $labels[$parts[0]] = $parts[1]
                Write-Host ("  {0}  {1}" -f $parts[0], $parts[1])
            }
            if ($labels.Count -gt 0) {
                $pick = "$(Read-Host '输入要还给 AI 的编号，直接回车返回')".Trim()
                if ($pick -and $labels.ContainsKey($pick)) { Show-AndOpen (& node $tool release $labels[$pick]) }
            }
        }
        '0' { return }
        default { Write-Host '没有这个编号。' }
    }
    Write-Host ''
    Read-Host '按回车继续' | Out-Null
}
