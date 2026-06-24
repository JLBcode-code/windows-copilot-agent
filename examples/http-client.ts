const response = await fetch("http://127.0.0.1:8000/v1/chat/completions", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    model: "copilot",
    messages: [{ role: "user", content: "Hello!" }],
  }),
});
console.log(await response.json());
