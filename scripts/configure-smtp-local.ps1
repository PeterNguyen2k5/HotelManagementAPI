#requires -Version 5.1
[CmdletBinding()]
param(
    [string]$SenderEmail,
    [string]$PublicBaseUrl = 'http://localhost:5057'
)

$ErrorActionPreference = 'Stop'
$projectPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'HotelManagementAPI.csproj'
$dotnetCommand = Get-Command dotnet -CommandType Application -ErrorAction Stop | Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($SenderEmail)) {
    $SenderEmail = Read-Host 'Gmail da tao App Password'
}
$SenderEmail = $SenderEmail.Trim()
try { $sender = [System.Net.Mail.MailAddress]::new($SenderEmail) }
catch { throw 'Dia chi email gui khong hop le.' }
if ($sender.Address -ne $SenderEmail) { throw 'Chi nhap dia chi email, khong kem ten hien thi.' }

$baseUri = $null
if (-not [Uri]::TryCreate($PublicBaseUrl, [UriKind]::Absolute, [ref]$baseUri) -or
    $baseUri.Scheme -notin @('http', 'https') -or
    ($baseUri.Scheme -eq 'http' -and -not $baseUri.IsLoopback) -or
    $baseUri.UserInfo -or $baseUri.Query -or $baseUri.Fragment) {
    throw 'PublicBaseUrl phai la HTTPS hoac HTTP localhost, khong kem query/token.'
}

$securePassword = $null
$passwordPointer = [IntPtr]::Zero
$password = $null
$payload = $null
$values = $null
$process = $null
try {
    $securePassword = Read-Host 'App Password Gmail (nhap an)' -AsSecureString
    $passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
    # Gmail displays app passwords in groups; discard grouping spaces.
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer) -replace '\s', ''
    if ($password -notmatch '^[A-Za-z0-9]{16}$') {
        throw 'App Password Gmail phai gom 16 ky tu chu/so. Khong dung mat khau dang nhap Gmail.'
    }
    $values = @{
        'CustomerEmail:Mode' = 'Smtp'
        'CustomerEmail:PublicBaseUrl' = $baseUri.AbsoluteUri.TrimEnd('/')
        'CustomerEmail:From' = $SenderEmail
        'CustomerEmail:Smtp:Host' = 'smtp.gmail.com'
        'CustomerEmail:Smtp:Port' = '587'
        'CustomerEmail:Smtp:Username' = $SenderEmail
        'CustomerEmail:Smtp:Password' = $password
    }
    $payload = ConvertTo-Json -InputObject $values -Compress
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $dotnetCommand.Source
    $start.Arguments = 'user-secrets set --project "' + $projectPath + '"'
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardInput = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    $process = [Diagnostics.Process]::Start($start)
    $stdout = $process.StandardOutput.ReadToEndAsync()
    $stderr = $process.StandardError.ReadToEndAsync()
    # Pass JSON through stdin: never place the password in command arguments or a temp file.
    $process.StandardInput.WriteLine($payload)
    $process.StandardInput.Close()
    $process.WaitForExit()
    $null = $stdout.GetAwaiter().GetResult()
    $null = $stderr.GetAwaiter().GetResult()
    if ($process.ExitCode -ne 0) { throw 'Khong luu duoc User Secrets. Kiem tra .NET SDK va quyen tai khoan Windows.' }

    Write-Host 'Da luu 7 cau hinh SMTP vao .NET User Secrets cua tai khoan Windows hien tai.'
    Write-Host 'Chua gui email. Khoi dong lai app: dotnet run --launch-profile http'
    foreach ($key in $values.Keys) {
        $envKey = $key.Replace(':', '__')
        if ($null -ne [Environment]::GetEnvironmentVariable($envKey)) {
            Write-Warning ('Bien moi truong ' + $envKey + ' dang ghi de User Secrets. Go bien nay truoc khi chay app.')
        }
    }
}
finally {
    if ($passwordPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer) }
    if ($null -ne $securePassword) { $securePassword.Dispose() }
    if ($null -ne $process) { $process.Dispose() }
    if ($null -ne $values) { $values.Clear() }
    $password = $null
    $payload = $null
}
