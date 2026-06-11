# 파일 변경을 감지하여 자동으로 Git Commit 및 Push를 실행하는 스크립트.

$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = "C:\Users\GN\.alert\public"
$watcher.Filter = "app.js"
$watcher.IncludeSubdirectories = $false
$watcher.EnableRaisingEvents = $true

Write-Host "자동 푸시 감시 스크립트가 가동되었습니다."
Write-Host "public/app.js 파일이 변경되면 자동으로 커밋 및 푸시가 진행됩니다."

$action = {
    Write-Host "변경 사항 감지! Git 커밋 및 푸시를 실행합니다."
    cd "C:\Users\GN\.alert"
    git add public/app.js
    git commit -m "fix: 설정 입력 중 배경 동기화에 의해 값이 초기화되는 오류 수정"
    git push
    Write-Host "푸시 완료."
}

$handler = Register-ObjectEvent -InputObject $watcher -EventName "Changed" -Action $action

try {
    while ($true) {
        Start-Sleep -Seconds 1
    }
} finally {
    Unregister-Event -SourceIdentifier $handler.Name
    $watcher.Dispose()
    Write-Host "자동 감시가 종료되었습니다."
}
