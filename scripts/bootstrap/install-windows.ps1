# Started by "Install on Windows.cmd". Gets NowCaption's own copy of Node.js (no admin rights, nothing changed
# system-wide), then runs scripts\setup.mjs, which does the rest. Keep this file ASCII: Windows PowerShell 5.1
# reads scripts without a BOM in the local code page.
param([switch]$NoPause, [Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads many times slower in PowerShell 5.1

$NodeVersion = 'v26.13.0'
$NodeSha256 = 'dcc60d59a0746999f99064a01c020445d54d84228c691cdbf25b49ac3b59150a'   # node-v26.13.0-win-x64.zip
$Here = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

function Finish([int]$Code) {
    if (-not $NoPause -and -not $env:CI) {
        Write-Host ''
        Read-Host 'Press Enter to close this window' | Out-Null
    }
    exit $Code
}

try {
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($arch -eq 'ARM64') {
        Write-Host 'NowCaption needs a Windows PC with an Intel or AMD processor: its speech engine has no Windows on Arm build.' -ForegroundColor Yellow
        Finish 1
    }
    $base = if ($env:NOWCAPTION_VESKTOP_HOME) { $env:NOWCAPTION_VESKTOP_HOME } else { Join-Path $env:LOCALAPPDATA 'NowCaption-Vesktop' }
    $tools = Join-Path $base 'tools'
    $nodeDir = Join-Path $tools "node-$NodeVersion-win-x64"
    $node = Join-Path $nodeDir 'node.exe'

    if (-not (Test-Path $node)) {
        Write-Host "Getting Node.js $NodeVersion for the installer (about 40 MB, kept in NowCaption's own folder)..."
        New-Item -ItemType Directory -Force $tools | Out-Null
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $zip = Join-Path $tools "node-$NodeVersion-win-x64.zip.part"
        Invoke-WebRequest -UseBasicParsing "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" -OutFile $zip
        $hash = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLowerInvariant()
        if ($hash -ne $NodeSha256) {
            Remove-Item $zip -Force
            throw "The Node.js download didn't match its SHA-256 ($hash), so it wasn't used. Try again later."
        }
        $stage = Join-Path $tools ".unpack-$PID"
        New-Item -ItemType Directory -Force $stage | Out-Null
        $tar = Join-Path $env:SystemRoot 'System32\tar.exe'
        if (Test-Path $tar) { & $tar -xf $zip -C $stage; if ($LASTEXITCODE -ne 0) { throw "tar couldn't unpack Node.js" } }
        else { Expand-Archive -Path $zip -DestinationPath $stage -Force }
        if (Test-Path $nodeDir) { Remove-Item $nodeDir -Recurse -Force }   # left over from an interrupted unpack
        Move-Item (Join-Path $stage "node-$NodeVersion-win-x64") $nodeDir
        Remove-Item $stage, $zip -Recurse -Force
    }
    # setup.mjs keeps the window open itself when there's something to read.
    & $node (Join-Path $Here 'scripts\setup.mjs') @Rest
    exit $LASTEXITCODE
} catch {
    Write-Host ''
    Write-Host "The installation didn't finish: $($_.Exception.Message)" -ForegroundColor Red
    Finish 1
}
