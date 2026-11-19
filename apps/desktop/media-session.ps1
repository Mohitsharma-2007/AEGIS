param(
  [ValidateSet('query', 'playPause', 'previous', 'next')]
  [string]$Action = 'query'
)
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime]
  $sessionType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSession, Windows.Media.Control, ContentType=WindowsRuntime]
  $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType=WindowsRuntime]
  function Await-WinRt($operation, $resultType) {
    $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
    if (-not $method) { throw 'WinRT async bridge unavailable.' }
    $task = $method.MakeGenericMethod($resultType).Invoke($null, @($operation))
    $task.Wait()
    return $task.Result
  }
  $request = $managerType.GetMethod('RequestAsync').Invoke($null, @())
  $manager = Await-WinRt $request $managerType
  $session = $manager.GetCurrentSession()
  if (-not $session) { $session = $manager.GetSessions() | Select-Object -First 1 }
  if (-not $session) { @{ available = $false; reason = 'No supported media session is active.' } | ConvertTo-Json -Compress; exit 0 }
  if ($Action -ne 'query') {
    $operation = switch ($Action) {
      'playPause' { $session.TryTogglePlayPauseAsync() }
      'previous' { $session.TrySkipPreviousAsync() }
      'next' { $session.TrySkipNextAsync() }
    }
    $ok = Await-WinRt $operation ([bool])
    @{ available = $true; ok = [bool]$ok } | ConvertTo-Json -Compress
    exit 0
  }
  $media = Await-WinRt ($session.TryGetMediaPropertiesAsync()) $propertiesType
  $playback = $session.GetPlaybackInfo()
  $timeline = $session.GetTimelineProperties()
  @{
    available = $true
    app = [string]$session.SourceAppUserModelId
    title = [string]$media.Title
    artist = [string]$media.Artist
    album = [string]$media.AlbumTitle
    playing = ([string]$playback.PlaybackStatus -eq 'Playing')
    position = [Math]::Max(0, [Math]::Round($timeline.Position.TotalSeconds))
    duration = [Math]::Max(0, [Math]::Round(($timeline.EndTime - $timeline.StartTime).TotalSeconds))
  } | ConvertTo-Json -Compress
} catch {
  @{ available = $false; reason = $_.Exception.Message } | ConvertTo-Json -Compress
  exit 0
}
