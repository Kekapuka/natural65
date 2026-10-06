# Запуск: powershell -File scripts/og-images.ps1 -Root <папка проекта>
# Перегенерируйте картинки после изменения app.tagline / offline.heading в locales/*.json
param([string]$Root)
# Генерирует assets/img/og/og-<lang>.png (1200x630) из логотипа и app.tagline словарей
Add-Type -AssemblyName System.Drawing

$fonts = @{ ru = 'Segoe UI'; en = 'Segoe UI'; es = 'Segoe UI'; zh = 'Microsoft YaHei'; ja = 'Yu Gothic UI'; ko = 'Malgun Gothic' }
$green = [System.Drawing.ColorTranslator]::FromHtml('#234826')
$cream = [System.Drawing.ColorTranslator]::FromHtml('#FFFEFB')
$creamSoft = [System.Drawing.Color]::FromArgb(215, 255, 254, 251)
$logo = [System.Drawing.Image]::FromFile("$Root\assets\img\logo\logo.png")
$outDir = "$Root\assets\img\og"
New-Item -ItemType Directory -Force $outDir | Out-Null

foreach ($lang in $fonts.Keys) {
  $json = Get-Content -Raw -Encoding UTF8 "$Root\locales\$lang.json" | ConvertFrom-Json
  $name = $json.'seo.siteName'
  $tagline = $json.'app.tagline'
  $offline = $json.'offline.heading'

  $bmp = New-Object System.Drawing.Bitmap 1200, 630
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = 'HighQuality'
  $g.InterpolationMode = 'HighQualityBicubic'
  $g.TextRenderingHint = 'AntiAliasGridFit'
  $g.Clear($green)

  # Логотип слева (у него тот же зелёный фон). TileFlipXY убирает
  # светлую кайму, которую даёт сглаживание на краях картинки
  $attrs = New-Object System.Drawing.Imaging.ImageAttributes
  $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $dest = New-Object System.Drawing.Rectangle 40, 75, 480, 480
  $g.DrawImage($logo, $dest, 0, 0, $logo.Width, $logo.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)

  $family = $fonts[$lang]
  $titleFont = New-Object System.Drawing.Font($family, 64, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $tagFont = New-Object System.Drawing.Font($family, 40, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $smallFont = New-Object System.Drawing.Font($family, 28, [System.Drawing.FontStyle]::Regular, [System.Drawing.GraphicsUnit]::Pixel)
  $creamBrush = New-Object System.Drawing.SolidBrush $cream
  $softBrush = New-Object System.Drawing.SolidBrush $creamSoft

  $g.DrawString($name, $titleFont, $creamBrush, (New-Object System.Drawing.RectangleF 540, 150, 620, 90))
  $g.DrawString($tagline, $tagFont, $creamBrush, (New-Object System.Drawing.RectangleF 540, 255, 620, 170))
  $g.FillRectangle($creamBrush, 540, 448, 72, 6)
  $g.DrawString($offline, $smallFont, $softBrush, (New-Object System.Drawing.RectangleF 540, 472, 620, 80))

  $bmp.Save("$outDir\og-$lang.png", [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose(); $titleFont.Dispose(); $tagFont.Dispose(); $smallFont.Dispose()
  Write-Output "og-$lang.png"
}
$logo.Dispose()
