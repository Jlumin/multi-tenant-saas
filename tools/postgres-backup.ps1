param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("backup", "restore-drill")]
    [string]$Action,

    [string]$BackupPath,

    [string]$ProjectName,

    [string]$EnvFile,

    [string[]]$ComposeFiles = @("compose.yaml")
)

$ErrorActionPreference = "Stop"
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
Push-Location $RepoRoot
try {
    $ComposeArgs = @("compose")
    if (-not [string]::IsNullOrWhiteSpace($ProjectName)) { $ComposeArgs += @("-p", $ProjectName) }
    if (-not [string]::IsNullOrWhiteSpace($EnvFile)) {
        $ResolvedEnvFile = (Resolve-Path -LiteralPath $EnvFile).Path
        $ComposeArgs += @("--env-file", $ResolvedEnvFile)
    }
    foreach ($ComposeFile in $ComposeFiles) {
        $ResolvedComposeFile = (Resolve-Path -LiteralPath $ComposeFile).Path
        $ComposeArgs += @("-f", $ResolvedComposeFile)
    }

    function Invoke-ComposeDb([string]$Command) {
        & docker @ComposeArgs exec -T db sh -ec $Command
        if ($LASTEXITCODE -ne 0) { throw "Database container command failed ($LASTEXITCODE)." }
    }

    if ($Action -eq "backup") {
        $BackupDir = Join-Path $RepoRoot ".backups"
        New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
        $Stamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $ContainerPath = "/tmp/sme-cloud-$Stamp.dump"
        $OutputPath = Join-Path $BackupDir "sme-cloud-$Stamp.dump"
        Invoke-ComposeDb "umask 077; pg_dump --format=custom --no-owner --no-acl -U `"`$POSTGRES_USER`" -d `"`$POSTGRES_DB`" -f '$ContainerPath'"
        & docker @ComposeArgs cp "db:$ContainerPath" $OutputPath
        if ($LASTEXITCODE -ne 0) { throw "Could not copy database archive from the container." }
        Invoke-ComposeDb "rm -f '$ContainerPath'"
        $Hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $OutputPath).Hash.ToLowerInvariant()
        Set-Content -LiteralPath "$OutputPath.sha256" -Value "$Hash  $(Split-Path -Leaf $OutputPath)" -Encoding ascii
        Write-Output "Backup created: $OutputPath"
        Write-Output "SHA-256 manifest: $OutputPath.sha256"
    }
    else {
        if ([string]::IsNullOrWhiteSpace($BackupPath)) { throw "Pass -BackupPath to a previously created .dump file." }
        $Archive = (Resolve-Path -LiteralPath $BackupPath).Path
        if ([IO.Path]::GetExtension($Archive) -ne ".dump") { throw "Restore drill accepts only a .dump archive." }
        $ExpectedHashPath = "$Archive.sha256"
        if (-not (Test-Path -LiteralPath $ExpectedHashPath)) { throw "SHA-256 manifest is missing: $ExpectedHashPath" }
        $ExpectedHash = ((Get-Content -LiteralPath $ExpectedHashPath -Raw).Trim() -split '\s+')[0].ToLowerInvariant()
        $ActualHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Archive).Hash.ToLowerInvariant()
        if ($ExpectedHash -ne $ActualHash) { throw "Backup SHA-256 does not match its manifest." }

        $Stamp = Get-Date -Format "yyyyMMddHHmmss"
        $ScratchDb = "sme_cloud_restore_drill_$Stamp"
        $ContainerPath = "/tmp/$ScratchDb.dump"
        $Created = $false
        try {
            & docker @ComposeArgs cp $Archive "db:$ContainerPath"
            if ($LASTEXITCODE -ne 0) { throw "Could not copy archive into the database container." }
            Invoke-ComposeDb "createdb -U `"`$POSTGRES_USER`" -T template0 '$ScratchDb'"
            $Created = $true
            Invoke-ComposeDb "pg_restore --exit-on-error --no-owner --no-acl -U `"`$POSTGRES_USER`" -d '$ScratchDb' '$ContainerPath'"
            $MigrationCount = (& docker @ComposeArgs exec -T db sh -ec "psql -At -U `"`$POSTGRES_USER`" -d '$ScratchDb' -c 'SELECT count(*) FROM django_migrations'").Trim()
            if ($LASTEXITCODE -ne 0 -or [int]$MigrationCount -le 0) { throw "Restored schema check failed." }
            Write-Output "Restore drill passed in temporary database $ScratchDb (migration records: $MigrationCount)."
        }
        finally {
            if ($Created -and $ScratchDb -match '^sme_cloud_restore_drill_[0-9]{14}$') {
                Invoke-ComposeDb "dropdb --if-exists --force -U `"`$POSTGRES_USER`" '$ScratchDb'"
            }
            & docker @ComposeArgs exec -T db sh -ec "rm -f '$ContainerPath'" | Out-Null
        }
    }
}
finally {
    Pop-Location
}
