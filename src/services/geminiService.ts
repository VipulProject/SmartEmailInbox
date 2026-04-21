import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export interface EmailClassification {
    category: 'important' | 'promotional' | 'notifications' | 'spam' | 'personal';
    priority: 'high' | 'medium' | 'low';
    impactScore: number;
    summary: string;
    actionRequired: boolean;
    reasoning: string;
}

export async function classifyEmail(
    subject: string, 
    snippet: string, 
    from: string, 
    interactionCount: number = 0, 
    isFrequentContact: boolean = false
): Promise<EmailClassification> {
    try {
        const context = isFrequentContact 
            ? `NOTE: This sender is a frequent contact (Interaction count: ${interactionCount}). Prioritize accordingly if the content is legitimate.`
            : `Interaction count for this sender: ${interactionCount}.`;

        const response = await ai.models.generateContent({
            model: "gemini-3-flash-preview",
            contents: `${context}
            Classify the following email:
            From: ${from}
            Subject: ${subject}
            Snippet: ${snippet}`,
            config: {
                systemInstruction: "You are an expert email triage assistant. Analyze emails and prioritize them. Frequent contacts typically implies personal or important business communication. Promotional content should still be categorized as promotional regardless of frequency. Provide an impact score from 0.0 to 10.0 representing the urgency and relevance of the email.",
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        category: {
                            type: Type.STRING,
                            enum: ['important', 'promotional', 'notifications', 'spam', 'personal']
                        },
                        priority: {
                            type: Type.STRING,
                            enum: ['high', 'medium', 'low']
                        },
                        impactScore: { type: Type.NUMBER },
                        summary: { type: Type.STRING },
                        actionRequired: { type: Type.BOOLEAN },
                        reasoning: { type: Type.STRING }
                    },
                    required: ['category', 'priority', 'impactScore', 'summary', 'actionRequired', 'reasoning']
                }
            }
        });

        return JSON.parse(response.text);
    } catch (error) {
        console.error("Gemini classification failed:", error);
        return {
            category: 'notifications',
            priority: 'low',
            impactScore: 2.5,
            summary: subject,
            actionRequired: false,
            reasoning: 'Error during AI classification'
        };
    }
}
