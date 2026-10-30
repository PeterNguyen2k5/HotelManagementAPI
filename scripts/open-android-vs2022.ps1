param(
    [switch]$CheckOnly,
    [string]$AndroidDotNetPath
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidRoot=Join-Path $projectRoot 'clients/HotelManagement.Android'
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if(-not(Test-Path -LiteralPath $vswhere)){throw 'Visual Studio Installer/vswhere.exe was not found.'}
$instances=@((& $vswhere -products '*' -version '[17.14,18.0)' -format json -utf8 | ConvertFrom-Json))
$vs=$instances | Where-Object {$_.productId -like 'Microsoft.VisualStudio.Product.*' -and $_.isComplete} | Select-Object -First 1
if(-not $vs){throw 'Visual Studio 2022 version 17.14 or newer is required.'}
$metadataPath=Join-Path $projectRoot 'obj/client-toolchain/toolchain.json'
if(-not $AndroidDotNetPath -and (Test-Path -LiteralPath $metadataPath)){
    $AndroidDotNetPath=(Get-Content -LiteralPath $metadataPath -Raw|ConvertFrom-Json).dotnet
}
if(-not $AndroidDotNetPath){$AndroidDotNetPath=(Get-Command dotnet -ErrorAction Stop).Source}
if(-not(Test-Path -LiteralPath $AndroidDotNetPath)){throw 'Android .NET SDK was not found. Supply -AndroidDotNetPath.'}
$sdkRoot=Split-Path ([IO.Path]::GetFullPath($AndroidDotNetPath)) -Parent
$toolRoot=Split-Path $sdkRoot -Parent
$savedEnvironment=@{}
foreach($key in @('DOTNET_ROOT','DOTNET_MSBUILD_SDK_RESOLVER_CLI_DIR','DOTNET_CLI_HOME','NUGET_PACKAGES','TEMP','TMP','PATH','DOTNET_GENERATE_ASPNET_CERTIFICATE')){
    $savedEnvironment[$key]=[Environment]::GetEnvironmentVariable($key,'Process')
}
try {
    # Override SDK discovery only for this Visual Studio process; do not change system settings.
    $env:DOTNET_ROOT=$sdkRoot
    $env:DOTNET_MSBUILD_SDK_RESOLVER_CLI_DIR=$sdkRoot
    $env:PATH="$sdkRoot;$env:PATH"
    $env:DOTNET_GENERATE_ASPNET_CERTIFICATE='false'
    foreach($entry in @{DOTNET_CLI_HOME='home';NUGET_PACKAGES='packages';TEMP='temp';TMP='temp'}.GetEnumerator()){
        $directory=Join-Path $toolRoot $entry.Value
        if(Test-Path -LiteralPath $directory){[Environment]::SetEnvironmentVariable($entry.Key,$directory,'Process')}
    }
    Push-Location $androidRoot
    try {
        $sdkVersion=(& $AndroidDotNetPath --version | Out-String).Trim()
        if($LASTEXITCODE -ne 0 -or $sdkVersion -notmatch '^9\.0\.3\d\d$'){
            throw 'This Android solution requires the .NET 9.0.3xx SDK for Visual Studio 2022.'
        }
        $workloads=(& $AndroidDotNetPath workload list --verbosity quiet | Out-String)
        if($LASTEXITCODE -ne 0 -or $workloads -notmatch '(?m)^android\s'){
            throw "Android workload is missing from $sdkRoot. Install it using this dotnet.exe, not the system dotnet.exe."
        }
        $idePaths=@(& $vswhere -products '*' -version '[17.14,18.0)' -requires Microsoft.VisualStudio.ComponentGroup.Maui.Android -property installationPath)
        $androidIdeInstalled=$idePaths -contains $vs.installationPath
        [pscustomobject]@{VisualStudio=$vs.installationPath;Sdk=$sdkVersion;SdkRoot=$sdkRoot;AndroidWorkload=$true;AndroidIdeInstalled=$androidIdeInstalled}
        if($CheckOnly){return}
        if(-not $androidIdeInstalled){
            throw "Install Android support in Visual Studio Installer first. Import clients/visualstudio-android.vsconfig into Visual Studio 2022."
        }
        $devenv=Join-Path $vs.installationPath 'Common7/IDE/devenv.exe'
        $solution=Join-Path $androidRoot 'HotelManagement.Android.slnx'
        Start-Process -FilePath $devenv -ArgumentList ('"'+$solution+'"') -WorkingDirectory $androidRoot | Out-Null
    } finally {Pop-Location}
} finally {
    foreach($entry in $savedEnvironment.GetEnumerator()){[Environment]::SetEnvironmentVariable($entry.Key,$entry.Value,'Process')}
}
