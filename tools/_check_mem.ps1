$os = Get-CimInstance Win32_OperatingSystem
"RAM free MB: " + [math]::Round($os.FreePhysicalMemory/1024)
"RAM total MB: " + [math]::Round($os.TotalVisibleMemorySize/1024)
Get-CimInstance Win32_PageFileUsage | ForEach-Object {
  "Pagefile: " + $_.Name + " alloc " + $_.AllocatedBaseSize + "MB current " + $_.CurrentUsage + "MB"
}
Get-CimInstance Win32_PageFileSetting | ForEach-Object {
  "PagefileSetting: " + $_.Name + " initial " + $_.InitialSize + " max " + $_.MaximumSize
}
