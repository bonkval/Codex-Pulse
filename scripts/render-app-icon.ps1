Add-Type -AssemblyName PresentationCore, PresentationFramework, WindowsBase

$projectRoot = Split-Path -Parent $PSScriptRoot
$pngPath = Join-Path $projectRoot 'assets\icon.png'
$icoPath = Join-Path $projectRoot 'assets\icon.ico'
$size = 256

$visual = New-Object System.Windows.Media.DrawingVisual
$context = $visual.RenderOpen()

$background = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 248, 247, 244))
$border = New-Object System.Windows.Media.Pen(
  (New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 216, 214, 209))),
  6
)
$context.DrawRoundedRectangle($background, $border, (New-Object System.Windows.Rect(8, 8, 240, 240)), 58, 58)

$mark = [System.Windows.Media.Geometry]::Parse('M20 4.8a4.5 4.5 0 0 1 4.5 4.5v4.9l4.3-2.5a4.5 4.5 0 1 1 4.5 7.8L29 22l4.3 2.5a4.5 4.5 0 1 1-4.5 7.8l-4.3-2.5v4.9a4.5 4.5 0 1 1-9 0v-4.9l-4.3 2.5a4.5 4.5 0 1 1-4.5-7.8L11 22l-4.3-2.5a4.5 4.5 0 1 1 4.5-7.8l4.3 2.5V9.3A4.5 4.5 0 0 1 20 4.8Z')
$ink = New-Object System.Windows.Media.SolidColorBrush([System.Windows.Media.Color]::FromArgb(255, 37, 37, 37))
$context.PushTransform((New-Object System.Windows.Media.ScaleTransform(6.4, 6.4)))
$context.DrawGeometry($ink, $null, $mark)
$context.Pop()
$context.Close()

$bitmap = New-Object System.Windows.Media.Imaging.RenderTargetBitmap($size, $size, 96, 96, [System.Windows.Media.PixelFormats]::Pbgra32)
$bitmap.Render($visual)
$encoder = New-Object System.Windows.Media.Imaging.PngBitmapEncoder
$encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($bitmap))
$pngStream = [System.IO.File]::Open($pngPath, [System.IO.FileMode]::Create)
$encoder.Save($pngStream)
$pngStream.Dispose()

$png = [System.IO.File]::ReadAllBytes($pngPath)
$icoStream = New-Object System.IO.MemoryStream
$writer = New-Object System.IO.BinaryWriter($icoStream)
$writer.Write([UInt16]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]1)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([Byte]0)
$writer.Write([UInt16]1)
$writer.Write([UInt16]32)
$writer.Write([UInt32]$png.Length)
$writer.Write([UInt32]22)
$writer.Write($png)
$writer.Flush()
[System.IO.File]::WriteAllBytes($icoPath, $icoStream.ToArray())
$writer.Dispose()
$icoStream.Dispose()
