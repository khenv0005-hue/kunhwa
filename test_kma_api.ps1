Add-Type -AssemblyName System.Web
# 위도 36.8365, 경도 128.6984 -> 격자 nx=89, ny=111 (영주/봉화 근처)
$nx = 89
$ny = 111
$now = Get-Date
if ($now.Minute -lt 40) { $now = $now.AddHours(-1) }
$baseDate = $now.ToString('yyyyMMdd')
$baseTime = $now.ToString('HH') + '00'
$key = [System.Web.HttpUtility]::UrlEncode('Bclip8wR9Tcgz/jPEcTpnhuAyyrGeu6kW0vTxi1ItGQMKH7OTLdAgYwQZvF1qu3BZSN2bBo6G2Dg7Gl3/X4qoQ==')
$url = "https://apis.data.go.kr/1360000/VilageFcstInfoService_2.0/getUltraSrtNcst?serviceKey=$key" + "&pageNo=1&numOfRows=100&dataType=JSON&base_date=$baseDate&base_time=$baseTime&nx=$nx&ny=$ny"
Write-Host "=== nx=$nx, ny=$ny, base_date=$baseDate, base_time=$baseTime ==="
try {
    $response = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 15
    $json = $response | ConvertTo-Json -Depth 5
    Write-Host $json
} catch {
    Write-Host "ERROR: $_"
}
