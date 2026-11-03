[CmdletBinding()]
param([string]$EnvFile = (Join-Path $PSScriptRoot '.env'), [switch]$CheckOnly, [switch]$ImportOnly)
$ErrorActionPreference = 'Stop'
$settings = @{}
$lineNumber = 0
foreach ($line in [System.IO.File]::ReadAllLines((Resolve-Path -LiteralPath $EnvFile).Path)) {
    $lineNumber++
    if ([string]::IsNullOrWhiteSpace($line) -or $line.TrimStart().StartsWith('#')) { continue }
    if ($line -notmatch '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') { throw "Linha $lineNumber invalida no arquivo de ambiente." }
    $key = $Matches[1]
    if ($settings.ContainsKey($key)) { throw "Variavel duplicada na linha $lineNumber." }
    $settings[$key] = $Matches[2]
}
foreach ($key in @('ConnectionStrings__Sesmt','Jwt__SigningKey','Seed__AdminEmail','Seed__AdminPassword')) {
    if ([string]::IsNullOrWhiteSpace($settings[$key])) { throw "Configure a variavel $key." }
}
if ($settings['ASPNETCORE_ENVIRONMENT'] -ne 'Development' -or $settings['DOTNET_ENVIRONMENT'] -ne 'Development') { throw 'Este script e exclusivo de desenvolvimento local.' }
if ($settings['Jwt__SigningKey'].Length -lt 32) { throw 'A chave JWT deve ter ao menos 32 caracteres.' }
if ($CheckOnly) { Write-Output 'Arquivo de ambiente valido. Nenhuma variavel ou banco foi alterado.'; return }
$project = Join-Path $PSScriptRoot 'SESMT.API/SESMT.API.csproj'
if (-not (Test-Path -LiteralPath $project -PathType Leaf)) { throw 'Execute este script na pasta do backend que contem SESMT.slnx.' }
foreach ($entry in $settings.GetEnumerator()) { [Environment]::SetEnvironmentVariable($entry.Key,$entry.Value,'Process') }
if ($ImportOnly) { Write-Output 'Configuracao importada no processo atual.'; return }
Push-Location $PSScriptRoot
try { & dotnet run --project $project --no-launch-profile; if ($LASTEXITCODE -ne 0) { throw 'A API encerrou com erro. Confira a mensagem do dotnet acima.' } }
finally { Pop-Location }
