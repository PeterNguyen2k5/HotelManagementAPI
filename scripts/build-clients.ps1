param(
    [ValidateSet('Windows','Android','All')][string]$Target='Windows',
    [string]$AndroidDotNetPath,
    [string]$AndroidSdkDirectory=$env:ANDROID_HOME,
    [string]$JavaSdkDirectory=$env:JAVA_HOME
)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function Run-Checked([string]$Executable,[string[]]$Arguments) {
    & $Executable @Arguments
    if($LASTEXITCODE -ne 0){throw "Build failed ($LASTEXITCODE)."}
}
$savedEnvironment=@{}
foreach($key in @('DOTNET_ROOT','DOTNET_CLI_HOME','APPDATA','NUGET_PACKAGES','TEMP','TMP')){$savedEnvironment[$key]=[Environment]::GetEnvironmentVariable($key,'Process')}
try {
    if($Target -in @('Windows','All')) {
        Push-Location (Join-Path $projectRoot 'clients')
        try {
            Run-Checked 'dotnet' @('publish','HotelManagement.WinForms/HotelManagement.WinForms.csproj','-c','Release','-r','win-x64','--self-contained','true','-p:PublishSingleFile=true','-p:EnableCompressionInSingleFile=true','-p:IncludeNativeLibrariesForSelfExtract=true','-o',(Join-Path $projectRoot 'App_Data/clients/WinForms'),'--nologo')
        } finally {Pop-Location}
    }
    if($Target -in @('Android','All')) {
        $metadataPath=Join-Path $projectRoot 'obj/client-toolchain/toolchain.json'
        if(-not $AndroidDotNetPath -and (Test-Path -LiteralPath $metadataPath)){$AndroidDotNetPath=(Get-Content -LiteralPath $metadataPath -Raw|ConvertFrom-Json).dotnet}
        if(-not $AndroidDotNetPath){$AndroidDotNetPath=(Get-Command dotnet -ErrorAction Stop).Source}
        if(-not (Test-Path -LiteralPath $AndroidDotNetPath)){throw 'Android .NET SDK was not found. Supply -AndroidDotNetPath.'}
        $sdkRoot=Split-Path $AndroidDotNetPath -Parent
        $toolRoot=Split-Path $sdkRoot -Parent
        if(-not $JavaSdkDirectory -and (Test-Path -LiteralPath (Join-Path $toolRoot 'jdk/bin/java.exe'))){$JavaSdkDirectory=Join-Path $toolRoot 'jdk'}
        if(-not $AndroidSdkDirectory -or -not $JavaSdkDirectory){throw 'Supply AndroidSdkDirectory and JavaSdkDirectory (JDK 21).'}
        $env:DOTNET_ROOT=$sdkRoot
        if(Test-Path -LiteralPath (Join-Path $toolRoot 'home')){$env:DOTNET_CLI_HOME=Join-Path $toolRoot 'home'}
        if(Test-Path -LiteralPath (Join-Path $toolRoot 'profile')){$env:APPDATA=Join-Path $toolRoot 'profile'}
        if(Test-Path -LiteralPath (Join-Path $toolRoot 'packages')){$env:NUGET_PACKAGES=Join-Path $toolRoot 'packages'}
        if(Test-Path -LiteralPath (Join-Path $toolRoot 'temp')){$env:TEMP=Join-Path $toolRoot 'temp';$env:TMP=$env:TEMP}
        Push-Location (Join-Path $projectRoot 'clients/HotelManagement.Android')
        try {
            Run-Checked $AndroidDotNetPath @('build','HotelManagement.Android.csproj','-c','Release','-f','net9.0-android',"-p:AndroidSdkDirectory=$AndroidSdkDirectory","-p:JavaSdkDirectory=$JavaSdkDirectory",'--nologo')
            $apk=Join-Path (Get-Location) 'bin/Release/net9.0-android/vn.annhien.hotel-Signed.apk'
            if(-not(Test-Path -LiteralPath $apk)){throw 'Signed APK was not produced.'}
            $output=Join-Path $projectRoot 'App_Data/clients/Android';New-Item -ItemType Directory -Path $output -Force|Out-Null
            Copy-Item -LiteralPath $apk -Destination (Join-Path $output 'AnNhien.apk') -Force
        } finally {Pop-Location}
    }
} finally {
    foreach($entry in $savedEnvironment.GetEnumerator()){[Environment]::SetEnvironmentVariable($entry.Key,$entry.Value,'Process')}
}
