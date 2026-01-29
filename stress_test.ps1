$iterations = 50
$successCount = 0

for ($i = 1; $i -le $iterations; $i++) {
    Write-Host "Iteration $i of $iterations..." -ForegroundColor Cyan
    bun test
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Tests failed on iteration $i" -ForegroundColor Red
        exit $LASTEXITCODE
    }
    $successCount++
}

Write-Host "All $successCount iterations passed successfully!" -ForegroundColor Green
