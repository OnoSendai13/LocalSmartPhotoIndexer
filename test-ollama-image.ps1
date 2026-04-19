# Load image as base64
$imgPath = "C:\Users\neuro\Downloads\Photos moi\DSC_9913 (1).jpeg"
$imgBytes = [System.IO.File]::ReadAllBytes($imgPath)
$imgB64 = [Convert]::ToBase64String($imgBytes)
$imgMime = "image/jpeg"

$body = @{
  model = 'minicpm-v'
  messages = @(
    @{
      role = 'user'
      content = @(
        @{ type = 'text'; text = 'Describe this image briefly' },
        @{ type = 'image_url'; image_url = @{ url = "data:$imgMime;base64,$imgB64" } }
      )
    }
  )
} | ConvertTo-Json -Depth 10

$params = @{
  Uri = 'http://localhost:11434/v1/chat/completions'
  Method = 'POST'
  ContentType = 'application/json'
  Body = $body
  TimeoutSec = 120
}

$result = Invoke-RestMethod @params
$result.choices[0].message
