export const generateFlashcardsFromNote = async (title, content) => {
  const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Gemini API key is missing. Check your .env file for VITE_GEMINI_API_KEY.");
  }

  // Active, free-tier Flash models checked in order of preference
  const models = [
    "gemini-3.7-flash",
    "gemini-3.5-flash",
    "gemini-3.1-flash-lite",
    "gemini-2.5-flash"
  ];
  let lastError = null;

  for (const model of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

      const payload = {
        contents: [
          {
            parts: [
              {
                text: `You are an expert tutor. Create concise study flashcards based on the following lesson notes titled "${title}". 
                Extract the most important facts, definitions, and concepts.
                
                Return a valid JSON array where each object has exactly two keys: "front" (the question or concept) and "back" (the answer or definition). Example format:
                [
                  {"front": "What is X?", "back": "X is Y."}
                ]
                
                Notes content:
                ${content}`
              }
            ]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json"
        }
      };

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || `Model ${model} failed.`);
      }

      const data = await response.json();
      const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (!rawText) {
        throw new Error(`Model ${model} returned an empty response text.`);
      }

      const cleanJson = rawText.replace(/```json/g, "").replace(/```/g, "").trim();
      const parsedCards = JSON.parse(cleanJson);
      
      if (!Array.isArray(parsedCards) || parsedCards.length === 0) {
        throw new Error(`Parsed result from ${model} is not a valid flashcard array.`);
      }

      return parsedCards;

    } catch (err) {
      console.warn(`Model ${model} failed or was busy. Trying fallback...`, err.message);
      lastError = err;
    }
  }

  throw new Error(lastError?.message || "All current free Gemini models are currently unavailable.");
};
