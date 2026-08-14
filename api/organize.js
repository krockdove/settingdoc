export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "POST 요청만 허용됩니다." });
  }

  try {
    const { prompt } = req.body || {};

    if (!prompt || typeof prompt !== "string") {
      return res.status(400).json({ error: "prompt가 필요합니다." });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        error: "ANTHROPIC_API_KEY 환경변수가 설정되지 않았습니다.",
      });
    }

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 3000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error:
          data?.error?.message ||
          `Anthropic API 오류 (${response.status})`,
      });
    }

    if (!Array.isArray(data.content)) {
      return res.status(502).json({
        error: "Anthropic API에서 올바른 응답을 받지 못했습니다.",
      });
    }

    const text = data.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("");

    return res.status(200).json({ text });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error?.message || "서버 오류가 발생했습니다.",
    });
  }
}