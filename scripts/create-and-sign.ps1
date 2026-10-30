# scripts/create-and-sign.ps1
param(
    [string]$Password = "AeroDesk2026!"
)

$ErrorActionPreference = "Stop"

$workspaceRoot = $PSScriptRoot | Split-Path -Parent
$certsDir = Join-Path $workspaceRoot "certs"
if (-not (Test-Path $certsDir)) {
    New-Item -ItemType Directory -Path $certsDir -Force | Out-Null
}

$pfxPath = Join-Path $certsDir "aerodesk-codesign.pfx"
$cerPath = Join-Path $certsDir "AeroDesk-Public.cer"

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       Arcix Windows Code Signing & Security Fix       " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Create Self-Signed Code Signing Certificate
Write-Host "[1/4] Generating local Code Signing Certificate..." -ForegroundColor Yellow
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Arcix Development, O=Arcix" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -NotAfter (Get-Date).AddYears(5) `
    -FriendlyName "Arcix Code Signing Certificate"

Write-Host "  Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green

# 2. Export PFX and CER
Write-Host "[2/4] Exporting certificate to $certsDir..." -ForegroundColor Yellow
$securePwd = ConvertTo-SecureString -String $Password -Force -AsPlainText
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password $securePwd | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null

Write-Host "  PFX created: $pfxPath" -ForegroundColor Green
Write-Host "  CER created: $cerPath" -ForegroundColor Green

# 3. Sign Executables
Write-Host "[3/4] Signing Arcix binaries with Authenticode signature..." -ForegroundColor Yellow
$binariesToSign = @(
    (Join-Path $workspaceRoot "release\win-unpacked\Arcix.exe"),
    (Join-Path $workspaceRoot "release\Arcix 1.0.0.exe"),
    (Join-Path $workspaceRoot "native-input\InputInjector.exe")
)

foreach ($bin in $binariesToSign) {
    if (Test-Path $bin) {
        # Unblock file (removes Mark-of-the-Web zone identifier)
        Unblock-File -Path $bin -ErrorAction SilentlyContinue
        # Sign
        $sigResult = Set-AuthenticodeSignature -FilePath $bin -Certificate $cert
        Write-Host "  Signed: $(Split-Path $bin -Leaf) -> Status: $($sigResult.Status)" -ForegroundColor Green
    } else {
        Write-Host "  Skipping (not found): $(Split-Path $bin -Leaf)" -ForegroundColor DarkGray
    }
}

Write-Host "[4/4] Code signing complete!" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next Steps:" -ForegroundColor Yellow
Write-Host "1. To trust this certificate permanently on this PC, run:" -ForegroundColor White
Write-Host "   Import-Certificate -FilePath '$cerPath' -CertStoreLocation 'Cert:\CurrentUser\Root'" -ForegroundColor Green
Write-Host "2. Or double-click 'certs\AeroDesk-Public.cer' -> Install Certificate -> Current User -> Trusted Root Certification Authorities." -ForegroundColor White
