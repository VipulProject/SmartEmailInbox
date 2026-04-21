export interface Email {
    id: string;
    threadId: string;
    subject: string;
    from: string;
    to: string;
    date: string;
    snippet: string;
    classification?: EmailClassification;
    interactionContext?: {
        count: number;
        isFrequent: boolean;
    };
}

export interface EmailClassification {
    category: 'important' | 'promotional' | 'notifications' | 'spam' | 'personal';
    priority: 'high' | 'medium' | 'low';
    impactScore: number;
    summary: string;
    actionRequired: boolean;
    reasoning: string;
}

export interface ContactNode {
    id: string;
    email: string;
    count: number;
}

export interface ContactLink {
    source: string;
    target: string;
    value: number;
}
