<#
  Dusk Box 托盘图标（右下角常驻小图标）。

  为什么需要它：改成无窗口启动之后，"关掉那个黑窗口"这个停止方式没有了，
  于是需要一个一直都在的入口。它只做三件事——打开界面 / 停止服务 / 退出，
  外加每 5 秒探一次服务是否还活着（服务挂了图标变暗、菜单项禁用）。

  只用系统自带的 .NET WinForms（Windows PowerShell 5.1 自带），不引入任何依赖。
  图标直接由 img/logo/logo.jpg 现算出来，所以换 logo 时侧栏、网页图标、托盘三处一起变，
  不需要谁再去维护一个 .ico 文件。

  文件必须以 UTF-8 带 BOM + CRLF 保存（见 test/s24-tray.test.js）：
  PowerShell 5.1 读没有 BOM 的 UTF-8 会把这里的中文读成乱码，
  结果就是菜单项变成一串问号。
#>
param(
  # 只找出服务端口然后退出（测试用；不建托盘）
  [switch]$Probe,
  # 真正把图标与菜单建出来、打印 ok 后退出（测试用；不显示托盘）
  [switch]$SelfTest
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$ProjectRoot = Split-Path -Parent $PSScriptRoot

# ---------------------------------------------------------------------------
# 找到服务当前在哪个端口
# ---------------------------------------------------------------------------

<#
  自己开 TCP 连接发 HTTP，不用 Invoke-RestMethod。

  原因是一次实测踩坑：这台机器上配了系统代理（127.0.0.1:1），
  PowerShell 的 Invoke-RestMethod 会**连本机请求都送去代理**，
  结果是一秒一次的超时——表现就是"服务明明在跑，托盘却一个个端口都探不到"，
  点「停止服务」也永远失败。直接开 socket 就从根上绕开了代理与 DNS。

  连接给 200ms 的预算：本机监听端口是秒连上的，超时说明那个端口没人听。
  不设预算的话，连不上的端口会一直挂着，扫 20 个端口能拖到 20 秒。
#>
function Invoke-DuskBoxHttp {
  param(
    [int]$Port,
    [string]$Method = 'GET',
    [string]$Path = '/api/health',
    [hashtable]$Headers = @{},
    [string]$Body = ''
  )

  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $connect = $client.ConnectAsync('127.0.0.1', $Port)
    if (-not $connect.Wait(200)) { return $null }
    if (-not $client.Connected) { return $null }

    $stream = $client.GetStream()
    $stream.ReadTimeout = 1500
    $stream.WriteTimeout = 1500

    $bodyBytes = @()
    $lines = @("$Method $Path HTTP/1.1", "Host: 127.0.0.1:$Port", 'Connection: close')
    if ($Body) {
      $bodyBytes = [Text.Encoding]::UTF8.GetBytes($Body)
      $lines += 'Content-Type: application/json'
      $lines += "Content-Length: $($bodyBytes.Length)"
    }
    foreach ($name in $Headers.Keys) {
      $lines += "${name}: $($Headers[$name])"
    }
    $raw = [Text.Encoding]::ASCII.GetBytes(($lines -join "`r`n") + "`r`n`r`n")
    $stream.Write($raw, 0, $raw.Length)
    if ($bodyBytes.Count -gt 0) { $stream.Write($bodyBytes, 0, $bodyBytes.Length) }

    $buffer = New-Object byte[] 8192
    $memory = New-Object System.IO.MemoryStream
    while ($true) {
      try {
        $read = $stream.Read($buffer, 0, $buffer.Length)
      } catch {
        break
      }
      if ($read -le 0) { break }
      $memory.Write($buffer, 0, $read)
      if ($memory.Length -gt 65536) { break }
    }
    return [Text.Encoding]::UTF8.GetString($memory.ToArray())
  } catch {
    return $null
  } finally {
    $client.Close()
  }
}

function Get-ConfigFile {
  if ($env:QSX_CONFIG_FILE -and $env:QSX_CONFIG_FILE.Trim()) { return $env:QSX_CONFIG_FILE.Trim() }
  return (Join-Path $ProjectRoot 'config.json')
}

function Get-ConfiguredPort {
  $file = Get-ConfigFile
  if (Test-Path -LiteralPath $file) {
    try {
      $text = [IO.File]::ReadAllText($file, (New-Object Text.UTF8Encoding($false)))
      $cfg = $text | ConvertFrom-Json
      if ($cfg.port -and [int]$cfg.port -gt 0) { return [int]$cfg.port }
    } catch {
      # 配置坏了就当没有，用默认端口继续找
    }
  }
  return 8899
}

# 是不是"我们自己的服务"，不能只看端口通不通——端口可能被别的程序占着
function Test-DuskBoxPort([int]$Port) {
  $response = Invoke-DuskBoxHttp -Port $Port -Path '/api/health'
  return ($null -ne $response -and $response -match '"app"\s*:\s*"Dusk Box"')
}

# 服务遇到端口被占会自己往后退，所以这里也要扫一段，不能只探一个
function Get-DuskBoxPort {
  $base = Get-ConfiguredPort
  for ($i = 0; $i -lt 20; $i += 1) {
    $candidate = $base + $i
    if (Test-DuskBoxPort $candidate) { return $candidate }
  }
  return 0
}

if ($Probe) {
  [Console]::Out.Write((Get-DuskBoxPort))
  exit 0
}

# ---------------------------------------------------------------------------
# 图标：由 logo 现算，运行中与已断开两种样子
# ---------------------------------------------------------------------------

function New-TrayBitmap([bool]$Dim) {
  $logoPath = Join-Path $ProjectRoot 'img\logo\logo.jpg'
  $source = [System.Drawing.Bitmap]::FromFile($logoPath)
  try {
    $size = 32
    $canvas = New-Object System.Drawing.Bitmap $size, $size
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

      # 居中裁成正方形：托盘图标是方的，直接拉伸会把 logo 拉变形
      $side = [Math]::Min($source.Width, $source.Height)
      $srcX = [int](($source.Width - $side) / 2)
      $srcY = [int](($source.Height - $side) / 2)
      $srcRect = New-Object System.Drawing.Rectangle $srcX, $srcY, $side, $side
      $dstRect = New-Object System.Drawing.Rectangle 0, 0, $size, $size
      $graphics.DrawImage($source, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)

      # 服务不在时压一层暗色，让"活着 / 不在了"一眼能看出来
      if ($Dim) {
        $veil = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(175, 24, 24, 24))
        $graphics.FillRectangle($veil, 0, 0, $size, $size)
        $veil.Dispose()
      }
    } finally {
      $graphics.Dispose()
    }
    return $canvas
  } finally {
    $source.Dispose()
  }
}

function New-TrayIcon([bool]$Dim) {
  # 位图要一直活着：GetHicon 拿到的句柄依赖它，被回收就成了碎图标
  $script:IconBitmaps += , (New-TrayBitmap $Dim)
  $bitmap = $script:IconBitmaps[-1]
  return [System.Drawing.Icon]::FromHandle($bitmap.GetHicon())
}

$script:IconBitmaps = @()

# ---------------------------------------------------------------------------
# 托盘本体
# ---------------------------------------------------------------------------

# 单例：已经有一个托盘在跑就不再起第二个（用户连点两次启动器也不会出现两个图标）。
# 用 Local\ 前缀：只在这一台机器的当前登录会话里唯一，不跨会话占名字。
$script:TrayMutex = New-Object System.Threading.Mutex ($false, 'Local\DuskBoxTray')
# 探针/自检是诊断用的，不该被"已经有一个托盘在跑"挡住（测试就要靠它们）。
if (-not $Probe -and -not $SelfTest) {
  if (-not $script:TrayMutex.WaitOne(0)) {
    exit 0
  }
}

$context = New-Object System.Windows.Forms.ApplicationContext
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = New-TrayIcon $false
$notify.Text = '茜色箱 · 服务运行中'
$notify.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$itemOpen = $menu.Items.Add('打开界面')
$itemStop = $menu.Items.Add('停止服务')
$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator)) | Out-Null
$itemExit = $menu.Items.Add('退出')
$notify.ContextMenuStrip = $menu

if ($SelfTest) {
  # 把图标与菜单都建出来了就算通过；这里不显示托盘，直接收摊
  $iconOk = ($notify.Icon -ne $null)
  $menuText = ($menu.Items | ForEach-Object { $_.Text }) -join '/'
  [Console]::Out.Write("ok icon=$iconOk menu=$menuText")
  $notify.Visible = $false
  $notify.Dispose()
  exit 0
}

$script:KnownPort = Get-DuskBoxPort

function Update-TrayState {
  $port = Get-DuskBoxPort
  $script:KnownPort = $port
  $alive = $port -gt 0

  $notify.Icon = New-TrayIcon (-not $alive)
  if ($alive) {
    $notify.Text = "茜色箱 · 服务运行中（端口 $port）"
  } else {
    $notify.Text = '茜色箱 · 服务已断开'
  }
  $itemOpen.Enabled = $alive
  $itemStop.Enabled = $alive
}

$itemOpen.Add_Click({
  $port = Get-DuskBoxPort
  if ($port -le 0) {
    $notify.ShowBalloonTip(3000, '茜色箱', '服务没有在运行，请双击桌面图标重新打开。', 'Info')
    return
  }
  Start-Process "http://localhost:$port"
})

$itemStop.Add_Click({
  $port = Get-DuskBoxPort
  if ($port -le 0) {
    $notify.ShowBalloonTip(3000, '茜色箱', '服务已经停了。', 'Info')
    return
  }
  try {
    # 自定义请求头是服务端的暗号：浏览器里别的网页带不上它，就停不掉服务
    $response = Invoke-DuskBoxHttp -Port $port -Method 'POST' -Path '/api/shutdown' `
      -Headers @{ 'X-DuskBox-Action' = 'shutdown' } -Body '{}'
    if ($response -and $response -match '200') {
      $notify.ShowBalloonTip(3000, '茜色箱', '服务已停止，数据都在。', 'Info')
    } else {
      $notify.ShowBalloonTip(3000, '茜色箱', '停止服务失败，可以再试一次。', 'Warning')
    }
  } catch {
    $notify.ShowBalloonTip(3000, '茜色箱', '停止服务失败，可以再试一次。', 'Warning')
  }
  Start-Sleep -Milliseconds 800
  $notify.Visible = $false
  $context.ExitThread()
})

$itemExit.Add_Click({
  # 只是关掉这个小图标，服务继续跑（要停服务请点上面那项）
  $notify.Visible = $false
  $context.ExitThread()
})

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 5000
$timer.Add_Tick({ Update-TrayState })
$timer.Start()

Update-TrayState

try {
  [System.Windows.Forms.Application]::Run($context)
} finally {
  $timer.Stop()
  $notify.Visible = $false
  $notify.Dispose()
}
