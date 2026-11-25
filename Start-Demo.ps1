$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$cutoverSecurePassword = Read-Host 'Admin password (16 to 128 characters, existing password for an existing workspace)' -AsSecureString
$cutoverPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($cutoverSecurePassword)
try {
    $env:CUTOVER_BOOTSTRAP_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($cutoverPasswordPointer)
    node src/main.mjs --demo
} finally {
    Remove-Item Env:CUTOVER_BOOTSTRAP_PASSWORD -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($cutoverPasswordPointer)
    $cutoverSecurePassword.Dispose()
}
