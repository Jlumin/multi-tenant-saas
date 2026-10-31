param(
    [ValidateRange(10, 10000)]
    [int]$Requests = 50,

    [string]$UiUrl = "http://127.0.0.1:4200/",

    [string]$ReadyUrl = "http://127.0.0.1:8000/api/v1/health/ready/"
)

$ErrorActionPreference = "Stop"

function Measure-Endpoint([string]$Name, [string]$Url) {
    1..3 | ForEach-Object {
        $Warmup = Invoke-WebRequest -Uri $Url -UseBasicParsing
        if ($Warmup.StatusCode -ne 200) { throw "$Name warmup returned HTTP $($Warmup.StatusCode)." }
    }

    $Samples = [Collections.Generic.List[double]]::new()
    for ($Index = 0; $Index -lt $Requests; $Index++) {
        $Watch = [Diagnostics.Stopwatch]::StartNew()
        $Response = Invoke-WebRequest -Uri $Url -UseBasicParsing
        $Watch.Stop()
        if ($Response.StatusCode -ne 200) { throw "$Name returned HTTP $($Response.StatusCode)." }
        $Samples.Add($Watch.Elapsed.TotalMilliseconds)
    }

    $Sorted = @($Samples | Sort-Object)
    [pscustomobject]@{
        Endpoint = $Name
        Requests = $Requests
        MinMs = [Math]::Round($Sorted[0], 1)
        P50Ms = [Math]::Round($Sorted[[int][Math]::Ceiling($Requests * 0.50) - 1], 1)
        P95Ms = [Math]::Round($Sorted[[int][Math]::Ceiling($Requests * 0.95) - 1], 1)
        MaxMs = [Math]::Round($Sorted[-1], 1)
    }
}

Measure-Endpoint "frontend" $UiUrl
Measure-Endpoint "database-ready" $ReadyUrl
