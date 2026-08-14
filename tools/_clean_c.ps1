$targets = @(
  "$env:LOCALAPPDATA\npm-cache",
  "$env:LOCALAPPDATA\Temp",
  "$env:LOCALAPPDATA\ms-playwright",
  "$env:LOCALAPPDATA\Google\Chrome\User Data\Default\Cache"
)
foreach ($t in $targets) {
  if (Test-Path $t) {
    try {
      $before = (Get-ChildItem $t -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      Remove-Item "$t\*" -Recurse -Force -ErrorAction SilentlyContinue
      $after = (Get-ChildItem $t -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum
      "CLEANED $t : freed $([math]::Round(($before-$after)/1MB)) MB"
    } catch {
      "SKIP $t : $($_.Exception.Message)"
    }
  } else {
    "MISS $t"
  }
}
$d = Get-PSDrive C
"C: free now: $([math]::Round($d.Free/1GB,1)) GB"
