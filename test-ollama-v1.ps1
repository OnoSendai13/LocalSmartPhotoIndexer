$body = @{
  model = 'minicpm-v'
  messages = @(
    @{
      role = 'user'
      content = @(
        @{ type = 'text'; text = 'say hello' }
      )
    }
  )
} | ConvertTo-Json -Depth 5

$params = @{
  Uri = 'http://localhost:11434/v1/chat/completions'
  Method = 'POST'
  ContentType = 'application/json'
  Body = $body
  TimeoutSec = 60
}

$result = Invoke-RestMethod @params
$result
